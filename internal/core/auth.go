// Package core implements the central business logic of OzyBase.
package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type AuthService struct {
	db        *data.DB
	jwtSecret string
	mailer    mailer.Mailer
}

func NewAuthService(db *data.DB, jwtSecret string, mailer mailer.Mailer) *AuthService {
	return &AuthService{
		db:        db,
		jwtSecret: jwtSecret,
		mailer:    mailer,
	}
}

// Signup handles user registration
func (s *AuthService) Signup(ctx context.Context, email, password string) (*User, error) {
	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	var user User
	err = s.db.Pool.QueryRow(ctx, `
		INSERT INTO _v_users (email, password_hash, role)
		VALUES ($1, $2, $3)
		RETURNING id, email, role, is_verified, created_at, updated_at
	`, email, string(hashedPassword), "user").Scan(&user.ID, &user.Email, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Generate verification token
	b := make([]byte, 32)
	if _, err := rand.Read(b); err == nil {
		token := hex.EncodeToString(b)
		expiresAt := time.Now().Add(24 * time.Hour)

		_, _ = s.db.Pool.Exec(ctx, `
			INSERT INTO _v_verification_tokens (user_id, token, expires_at)
			VALUES ($1, $2, $3)
		`, user.ID, token, expiresAt)

		// Send email (async ideally, but simple for now)
		_ = s.mailer.SendVerificationEmail(user.Email, token)
	}

	return &user, nil
}

// Login verifies credentials and returns a JWT
func (s *AuthService) Login(ctx context.Context, email, password string) (string, *User, error) {
	var user User
	err := s.db.Pool.QueryRow(ctx, `
		SELECT id, email, password_hash, role, is_verified, created_at, updated_at
		FROM _v_users
		WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return "", nil, errors.New("invalid email or password")
	}

	// Compare passwords
	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password))
	if err != nil {
		return "", nil, errors.New("invalid email or password")
	}

	// Generate JWT
	tokenString, err := s.generateToken(user.ID, user.Role)
	if err != nil {
		return "", nil, err
	}

	return tokenString, &user, nil
}

func (s *AuthService) generateToken(userID, role string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"role":    role,
		"exp":     time.Now().Add(time.Hour * 72).Unix(),
	})

	return token.SignedString([]byte(s.jwtSecret))
}

// GenerateTokenForUser exposes internal token generation logic
func (s *AuthService) GenerateTokenForUser(userID, role string) (string, error) {
	return s.generateToken(userID, role)
}

// RequestPasswordReset generates a reset token and saves it
func (s *AuthService) RequestPasswordReset(ctx context.Context, email string) (string, error) {
	var userID string
	err := s.db.Pool.QueryRow(ctx, "SELECT id FROM _v_users WHERE email = $1", email).Scan(&userID)
	if err != nil {
		// To prevent user enumeration, we return success even if email doesn't exist
		// but in the backend we don't do anything.
		return "", nil
	}

	// Generate a random token
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)

	// Set expiration (1 hour)
	expiresAt := time.Now().Add(time.Hour)

	// Save token
	_, err = s.db.Pool.Exec(ctx, `
		INSERT INTO _v_reset_tokens (user_id, token, expires_at)
		VALUES ($1, $2, $3)
	`, userID, token, expiresAt)

	if err != nil {
		return "", fmt.Errorf("failed to save reset token: %w", err)
	}

	// In a real app, you would send an email here.
	_ = s.mailer.SendPasswordResetEmail(email, token)

	return token, nil
}

// ConfirmPasswordReset verifies the token and updates the user's password
func (s *AuthService) ConfirmPasswordReset(ctx context.Context, token, newPassword string) error {
	var userID string
	var expiresAt time.Time

	err := s.db.Pool.QueryRow(ctx, `
		SELECT user_id, expires_at FROM _v_reset_tokens WHERE token = $1
	`, token).Scan(&userID, &expiresAt)

	if err != nil {
		return errors.New("invalid or expired reset token")
	}

	if time.Now().After(expiresAt) {
		return errors.New("reset token has expired")
	}

	// Hash new password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	// Update password and delete token in a transaction
	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, "UPDATE _v_users SET password_hash = $1 WHERE id = $2", string(hashedPassword), userID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, "DELETE FROM _v_reset_tokens WHERE token = $1", token)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// VerifyEmail marks a user as verified if the token is valid
func (s *AuthService) VerifyEmail(ctx context.Context, token string) error {
	var userID string
	var expiresAt time.Time

	err := s.db.Pool.QueryRow(ctx, `
		SELECT user_id, expires_at FROM _v_verification_tokens WHERE token = $1
	`, token).Scan(&userID, &expiresAt)

	if err != nil {
		return errors.New("invalid or expired verification token")
	}

	if time.Now().After(expiresAt) {
		return errors.New("verification token has expired")
	}

	// Update user and delete token
	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, "UPDATE _v_users SET is_verified = TRUE WHERE id = $1", userID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, "DELETE FROM _v_verification_tokens WHERE token = $1", token)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// UpdateUserRole updates a user's role
func (s *AuthService) UpdateUserRole(ctx context.Context, userID, newRole string) error {
	_, err := s.db.Pool.Exec(ctx, "UPDATE _v_users SET role = $1 WHERE id = $2", newRole, userID)
	return err
}

// HandleOAuthLogin handles authentication via external providers
func (s *AuthService) HandleOAuthLogin(ctx context.Context, provider, providerID, email string, data map[string]any) (string, *User, error) {
	var userID string
	var user User

	// 1. Check if identity already exists
	err := s.db.Pool.QueryRow(ctx, `
		SELECT user_id FROM _v_identities
		WHERE provider = $1 AND provider_id = $2
	`, provider, providerID).Scan(&userID)

	if err == nil {
		// Identity exists, fetch user
		err = s.db.Pool.QueryRow(ctx, `
			SELECT id, email, role, is_verified, created_at, updated_at
			FROM _v_users WHERE id = $1
		`, userID).Scan(&user.ID, &user.Email, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt)

		if err != nil {
			return "", nil, err
		}

		// Update last sign-in
		_, _ = s.db.Pool.Exec(ctx, "UPDATE _v_identities SET last_signin_at = NOW(), identity_data = $1 WHERE provider = $2 AND provider_id = $3", data, provider, providerID)

	} else {
		// 2. Identity does not exist, check if user with email exists
		err = s.db.Pool.QueryRow(ctx, `
			SELECT id, email, role, is_verified, created_at, updated_at
			FROM _v_users WHERE email = $1
		`, email).Scan(&user.ID, &user.Email, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt)

		if err != nil {
			// 3. User does not exist, create new user
			err = s.db.Pool.QueryRow(ctx, `
				INSERT INTO _v_users (email, password_hash, role, is_verified)
				VALUES ($1, $2, $3, $4)
				RETURNING id, email, role, is_verified, created_at, updated_at
			`, email, "OAUTH_LOGIN", "user", true).Scan(&user.ID, &user.Email, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt)

			if err != nil {
				return "", nil, fmt.Errorf("failed to create user: %w", err)
			}
		}

		// 4. Link identity to user
		_, err = s.db.Pool.Exec(ctx, `
			INSERT INTO _v_identities (user_id, provider, provider_id, identity_data)
			VALUES ($1, $2, $3, $4)
		`, user.ID, provider, providerID, data)

		if err != nil {
			return "", nil, fmt.Errorf("failed to link identity: %w", err)
		}
	}

	// 5. Generate JWT
	tokenString, err := s.generateToken(user.ID, user.Role)
	if err != nil {
		return "", nil, err
	}

	return tokenString, &user, nil
}
