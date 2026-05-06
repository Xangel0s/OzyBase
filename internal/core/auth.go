// Package core implements the central business logic of OzyBase.
package core

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

type AuthService struct {
	db        *data.DB
	jwtSecret string
	mailer    mailer.Mailer
}

var (
	ErrUserNotFound            = errors.New("user not found")
	ErrCannotDeleteCurrentUser = errors.New("cannot delete the current authenticated user")
	ErrCannotDeleteLastAdmin   = errors.New("cannot delete the last admin")
	ErrCannotDemoteLastAdmin   = errors.New("cannot demote the last admin")
	ErrInvalidRefreshToken     = errors.New("invalid refresh token")
	ErrRefreshTokenReuse       = errors.New("refresh token reuse detected")
)

const (
	accessTokenTTL  = 72 * time.Hour
	refreshTokenTTL = 30 * 24 * time.Hour
)

func NewAuthService(db *data.DB, jwtSecret string, mailer mailer.Mailer) *AuthService {
	return &AuthService{
		db:        db,
		jwtSecret: jwtSecret,
		mailer:    mailer,
	}
}

func (s *AuthService) DB() *data.DB {
	return s.db
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

		_ = mailer.SendTemplateEmail(ctx, s.db, s.mailer, "verification", user.Email, map[string]string{
			"app_name":    "OzyBase",
			"action_link": buildTokenURL("/verify-email", token),
			"token":       token,
		})
	}

	return &user, nil
}

// AuthLoginResult represents the outcome of a login attempt
type AuthLoginResult struct {
	Token        string `json:"token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	MFAStore     string `json:"mfa_store,omitempty"` // Temporary identifier for MFA verification
	MFARequired  bool   `json:"mfa_required"`
	User         *User  `json:"user"`
}

type TokenPair struct {
	AccessToken  string `json:"token"`
	RefreshToken string `json:"refresh_token"`
}

type AdminPasswordResetResult struct {
	TemporaryPassword   string `json:"temporary_password,omitempty"`
	SessionsTerminated  int64  `json:"sessions_terminated"`
	RefreshTokensRevoked int64 `json:"refresh_tokens_revoked"`
}

// Login verifies credentials and returns a AuthLoginResult
func (s *AuthService) Login(ctx context.Context, email, password, ip, ua string) (*AuthLoginResult, error) {
	var user User
	err := s.db.Pool.QueryRow(ctx, `
		SELECT id, email, password_hash, role, is_verified, created_at, updated_at
		FROM _v_users
		WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return nil, errors.New("invalid email or password")
	}

	// Compare passwords
	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password))
	if err != nil {
		return nil, errors.New("invalid email or password")
	}

	// Check if MFA is enabled
	var mfaEnabled bool
	_ = s.db.Pool.QueryRow(ctx, "SELECT is_enabled FROM _v_user_2fa WHERE user_id = $1", user.ID).Scan(&mfaEnabled)

	if mfaEnabled {
		// Return partial result, no token yet
		return &AuthLoginResult{
			MFARequired: true,
			MFAStore:    user.ID, // For simplicity in this phase, using userID. In Phase 3, use a signed temp token.
			User:        &user,
		}, nil
	}

	// Not MFA enabled, generate full JWT, session, and refresh token.
	pair, err := s.GenerateSessionTokenPair(ctx, user.ID, user.Role, ip, ua, false)
	if err != nil {
		return nil, err
	}

	return &AuthLoginResult{
		Token:        pair.AccessToken,
		RefreshToken: pair.RefreshToken,
		MFARequired:  false,
		User:         &user,
	}, nil
}

func (s *AuthService) generateToken(ctx context.Context, userID, role string) (string, error) {
	// Generate a unique ID for this token to prevent collisions if generated in same second
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate token entropy: %w", err)
	}
	jti := hex.EncodeToString(b)
	now := time.Now().UTC()

	appMetadata := map[string]string{}
	if workspaceID, err := s.resolveWorkspaceClaim(ctx, userID); err == nil && workspaceID != "" {
		appMetadata["workspace_id"] = workspaceID
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":          userID,
		"user_id":      userID,
		"role":         role,
		"aud":          "authenticated",
		"iss":          "ozybase",
		"iat":          now.Unix(),
		"nbf":          now.Unix(),
		"exp":          now.Add(accessTokenTTL).Unix(),
		"jti":          jti,
		"app_metadata": appMetadata,
	})

	return token.SignedString([]byte(s.jwtSecret))
}

func (s *AuthService) resolveWorkspaceClaim(ctx context.Context, userID string) (string, error) {
	var workspaceID string
	err := s.db.Pool.QueryRow(ctx, `
		SELECT workspace_id::text
		FROM _v_workspace_members
		WHERE user_id = $1::uuid
		ORDER BY
			CASE role
				WHEN 'owner' THEN 0
				WHEN 'admin' THEN 1
				WHEN 'member' THEN 2
				ELSE 3
			END,
			joined_at ASC
		LIMIT 1
	`, userID).Scan(&workspaceID)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(workspaceID), nil
}

func generateOpaqueToken(byteLen int) (raw string, hashed string, err error) {
	b := make([]byte, byteLen)
	if _, err = rand.Read(b); err != nil {
		return "", "", fmt.Errorf("failed to generate token entropy: %w", err)
	}
	raw = hex.EncodeToString(b)
	hash := sha256.Sum256([]byte(raw))
	hashed = hex.EncodeToString(hash[:])
	return raw, hashed, nil
}

func generateTemporaryPassword(length int) (string, error) {
	if length < 12 {
		length = 16
	}
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+"
	buf := make([]byte, length)
	randBytes := make([]byte, length)
	if _, err := rand.Read(randBytes); err != nil {
		return "", fmt.Errorf("failed to generate temporary password entropy: %w", err)
	}
	for i := range buf {
		buf[i] = alphabet[int(randBytes[i])%len(alphabet)]
	}
	return string(buf), nil
}

// GenerateTokenOnly generates a signed JWT without persisting a session row.
// Use this only when session persistence is handled separately in the same transaction.
func (s *AuthService) GenerateTokenOnly(userID, role string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate token entropy: %w", err)
	}

	now := time.Now().UTC()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":          userID,
		"user_id":      userID,
		"role":         role,
		"aud":          "authenticated",
		"iss":          "ozybase",
		"iat":          now.Unix(),
		"nbf":          now.Unix(),
		"exp":          now.Add(accessTokenTTL).Unix(),
		"jti":          hex.EncodeToString(b),
		"app_metadata": map[string]string{},
	})

	return token.SignedString([]byte(s.jwtSecret))
}

// GenerateSessionTokenPair creates a signed JWT, a backing session row, and a rotating refresh token.
func (s *AuthService) GenerateSessionTokenPair(ctx context.Context, userID, role, ip, ua string, isMFA bool) (*TokenPair, error) {
	tokenString, err := s.generateToken(ctx, userID, role)
	if err != nil {
		return nil, err
	}

	accessHash := sha256.Sum256([]byte(tokenString))
	tokenHash := hex.EncodeToString(accessHash[:])

	refreshRaw, refreshHash, err := generateOpaqueToken(48)
	if err != nil {
		return nil, err
	}

	expiresAt := time.Now().Add(accessTokenTTL)
	refreshExpiresAt := time.Now().Add(refreshTokenTTL)

	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var sessionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO _v_sessions (user_id, token_hash, ip_address, user_agent, is_mfa_verified, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id::text
	`, userID, tokenHash, ip, ua, isMFA, expiresAt).Scan(&sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO _v_refresh_tokens (session_id, user_id, token_hash, last_ip, expires_at)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5)
	`, sessionID, userID, refreshHash, strings.TrimSpace(ip), refreshExpiresAt); err != nil {
		return nil, fmt.Errorf("failed to create refresh token: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &TokenPair{AccessToken: tokenString, RefreshToken: refreshRaw}, nil
}

// GenerateTokenForUser exposes internal token generation logic and creates a session
func (s *AuthService) GenerateTokenForUser(ctx context.Context, userID, role, ip, ua string, isMFA bool) (string, error) {
	pair, err := s.GenerateSessionTokenPair(ctx, userID, role, ip, ua, isMFA)
	if err != nil {
		return "", err
	}
	return pair.AccessToken, nil
}

// RefreshSession rotates refresh tokens and returns a new token pair.
// If token reuse is detected, all sessions for the user are revoked.
func (s *AuthService) RefreshSession(ctx context.Context, refreshToken, ip, ua string) (*TokenPair, error) {
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" {
		return nil, ErrInvalidRefreshToken
	}

	refreshHash := sha256.Sum256([]byte(refreshToken))
	encodedRefreshHash := hex.EncodeToString(refreshHash[:])

	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var tokenID, userID, sessionID, role string
	var lastIP, sessionIP sql.NullString
	var expiresAt time.Time
	var revokedAt sql.NullTime
	var replacedBy sql.NullString

	err = tx.QueryRow(ctx, `
		SELECT rt.id::text, rt.user_id::text, rt.session_id::text, rt.expires_at, rt.revoked_at, COALESCE(rt.replaced_by_token_id::text, ''), u.role, rt.last_ip, s.ip_address
		FROM _v_refresh_tokens rt
		JOIN _v_users u ON u.id = rt.user_id
		JOIN _v_sessions s ON s.id = rt.session_id
		WHERE rt.token_hash = $1
		  AND s.expires_at > NOW()
		FOR UPDATE OF rt, s
	`, encodedRefreshHash).Scan(&tokenID, &userID, &sessionID, &expiresAt, &revokedAt, &replacedBy, &role, &lastIP, &sessionIP)
	if err != nil {
		return nil, ErrInvalidRefreshToken
	}

	resolvedIP := strings.TrimSpace(ip)
	if resolvedIP == "" {
		resolvedIP = strings.TrimSpace(lastIP.String)
	}
	if resolvedIP == "" {
		resolvedIP = strings.TrimSpace(sessionIP.String)
	}

	if revokedAt.Valid || strings.TrimSpace(replacedBy.String) != "" {
		log.Printf("[AUTH] Reuse detected for user %s, revoking all tokens", userID)
		_, _ = tx.Exec(ctx, `DELETE FROM _v_sessions WHERE user_id = $1::uuid`, userID)
		_, _ = tx.Exec(ctx, `UPDATE _v_refresh_tokens SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL`, userID)
		_ = tx.Commit(ctx)
		return nil, ErrRefreshTokenReuse
	}

	if time.Now().After(expiresAt) {
		_, _ = tx.Exec(ctx, `UPDATE _v_refresh_tokens SET revoked_at = NOW(), last_used_at = NOW() WHERE id = $1::uuid`, tokenID)
		_ = tx.Commit(ctx)
		return nil, ErrInvalidRefreshToken
	}

	accessToken, err := s.generateToken(ctx, userID, role)
	if err != nil {
		return nil, err
	}

	newRefreshRaw, newRefreshHash, err := generateOpaqueToken(48)
	if err != nil {
		return nil, err
	}

	var newRefreshID string
	err = tx.QueryRow(ctx, `
		INSERT INTO _v_refresh_tokens (session_id, user_id, token_hash, last_ip, expires_at, parent_token_id)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
		RETURNING id::text
	`, sessionID, userID, newRefreshHash, resolvedIP, time.Now().Add(refreshTokenTTL), tokenID).Scan(&newRefreshID)
	if err != nil {
		return nil, fmt.Errorf("failed to rotate refresh token: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE _v_refresh_tokens
		SET revoked_at = NOW(), last_used_at = NOW(), replaced_by_token_id = $2::uuid
		WHERE id = $1::uuid
	`, tokenID, newRefreshID); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE _v_sessions
		SET last_used_at = NOW(),
			ip_address = COALESCE(NULLIF($2, ''), ip_address),
			user_agent = COALESCE(NULLIF($3, ''), user_agent)
		WHERE id = $1::uuid
	`, sessionID, strings.TrimSpace(ip), strings.TrimSpace(ua)); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &TokenPair{AccessToken: accessToken, RefreshToken: newRefreshRaw}, nil
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

	_ = mailer.SendTemplateEmail(ctx, s.db, s.mailer, "password_reset", email, map[string]string{
		"app_name":    "OzyBase",
		"action_link": buildTokenURL("/reset-password", token),
		"token":       token,
	})

	return token, nil
}

func buildTokenURL(path, token string) string {
	base := strings.TrimSpace(os.Getenv("SITE_URL"))
	if base == "" {
		base = "http://localhost:5342"
	}
	base = strings.TrimRight(base, "/")

	u, err := url.Parse(base)
	if err != nil || u.Scheme == "" || u.Host == "" {
		u, _ = url.Parse("http://localhost:5342")
	}

	u.Path = strings.TrimRight(u.Path, "/") + path
	query := u.Query()
	query.Set("token", token)
	u.RawQuery = query.Encode()

	return u.String()
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

// ListUsers returns real users from the authentication store.
func (s *AuthService) ListUsers(ctx context.Context, limit int) ([]User, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	rows, err := s.db.Pool.Query(ctx, `
		SELECT id, email, role, is_verified, created_at, updated_at
		FROM _v_users
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := make([]User, 0, limit)
	for rows.Next() {
		var user User
		if scanErr := rows.Scan(&user.ID, &user.Email, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt); scanErr != nil {
			return nil, scanErr
		}
		users = append(users, user)
	}

	return users, rows.Err()
}

// UpdateUserRole updates a user's role
func (s *AuthService) UpdateUserRole(ctx context.Context, userID, newRole string) error {
	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var currentRole string
	if err := tx.QueryRow(ctx, "SELECT role FROM _v_users WHERE id = $1", userID).Scan(&currentRole); err != nil {
		return ErrUserNotFound
	}

	if strings.TrimSpace(currentRole) == "admin" && strings.TrimSpace(newRole) != "admin" {
		var adminCount int
		if err := tx.QueryRow(ctx, "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&adminCount); err != nil {
			return err
		}
		if adminCount <= 1 {
			return ErrCannotDemoteLastAdmin
		}
	}

	if _, err := tx.Exec(ctx, "UPDATE _v_users SET role = $1 WHERE id = $2", newRole, userID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *AuthService) DeleteUser(ctx context.Context, targetUserID, actorUserID string) error {
	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var targetRole string
	if err := tx.QueryRow(ctx, "SELECT role FROM _v_users WHERE id = $1", targetUserID).Scan(&targetRole); err != nil {
		return ErrUserNotFound
	}

	if strings.TrimSpace(targetUserID) == strings.TrimSpace(actorUserID) {
		return ErrCannotDeleteCurrentUser
	}

	if strings.TrimSpace(targetRole) == "admin" {
		var adminCount int
		if err := tx.QueryRow(ctx, "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&adminCount); err != nil {
			return err
		}
		if adminCount <= 1 {
			return ErrCannotDeleteLastAdmin
		}
	}

	cleanupStatements := []struct {
		query                  string
		tolerateUndefinedTable bool
	}{
		{query: "DELETE FROM _v_sessions WHERE user_id = $1"},
		{query: "DELETE FROM _v_verification_tokens WHERE user_id = $1"},
		{query: "DELETE FROM _v_reset_tokens WHERE user_id = $1"},
		{query: "DELETE FROM _v_identities WHERE user_id = $1"},
		{query: "DELETE FROM _v_user_2fa WHERE user_id = $1"},
		{query: "DELETE FROM _v_workspace_members WHERE user_id = $1"},
		{query: "DELETE FROM _v_table_views WHERE user_id = $1", tolerateUndefinedTable: true},
	}

	for _, statement := range cleanupStatements {
		if _, err := tx.Exec(ctx, statement.query, targetUserID); err != nil {
			if statement.tolerateUndefinedTable && isUndefinedTableError(err) {
				continue
			}
			return err
		}
	}

	commandTag, err := tx.Exec(ctx, "DELETE FROM _v_users WHERE id = $1", targetUserID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return ErrUserNotFound
	}

	return tx.Commit(ctx)
}

// AdminResetUserPassword updates a user's password using bcrypt and optionally revokes all active sessions/tokens.
func (s *AuthService) AdminResetUserPassword(ctx context.Context, targetUserID, newPassword string, forceLogout bool) (*AdminPasswordResetResult, error) {
	targetUserID = strings.TrimSpace(targetUserID)
	if targetUserID == "" {
		return nil, ErrUserNotFound
	}

	generatedPassword := ""
	passwordToApply := strings.TrimSpace(newPassword)
	if passwordToApply == "" {
		tempPassword, err := generateTemporaryPassword(20)
		if err != nil {
			return nil, err
		}
		generatedPassword = tempPassword
		passwordToApply = tempPassword
	}

	if len(passwordToApply) < 12 {
		return nil, errors.New("password must be at least 12 characters")
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(passwordToApply), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM _v_users WHERE id = $1)`, targetUserID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrUserNotFound
	}

	if _, err := tx.Exec(ctx, `UPDATE _v_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, string(hashedPassword), targetUserID); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM _v_reset_tokens WHERE user_id = $1`, targetUserID); err != nil {
		return nil, err
	}

	result := &AdminPasswordResetResult{TemporaryPassword: generatedPassword}
	if forceLogout {
		revokeTag, revokeErr := tx.Exec(ctx, `
			UPDATE _v_refresh_tokens
			SET revoked_at = NOW(),
				last_used_at = COALESCE(last_used_at, NOW())
			WHERE user_id = $1::uuid
			  AND revoked_at IS NULL
		`, targetUserID)
		if revokeErr != nil {
			return nil, revokeErr
		}

		deleteTag, deleteErr := tx.Exec(ctx, `DELETE FROM _v_sessions WHERE user_id = $1::uuid`, targetUserID)
		if deleteErr != nil {
			return nil, deleteErr
		}

		result.RefreshTokensRevoked = revokeTag.RowsAffected()
		result.SessionsTerminated = deleteTag.RowsAffected()
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return result, nil
}

func isUndefinedTableError(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "42P01"
	}
	return false
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
		if _, err := s.db.Pool.Exec(ctx, "UPDATE _v_identities SET last_signin_at = NOW(), identity_data = $1 WHERE provider = $2 AND provider_id = $3", data, provider, providerID); err != nil {
			log.Printf("Warning: Failed to update OAuth identity: %v", err)
		}

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

	// 5. Generate JWT and Session
	pair, err := s.GenerateSessionTokenPair(ctx, user.ID, user.Role, "", "", false)
	if err != nil {
		return "", nil, err
	}

	return pair.AccessToken, &user, nil
}

// ListSessions returns all active sessions for a user
func (s *AuthService) ListSessions(ctx context.Context, userID string) ([]Session, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT id, user_id, ip_address, user_agent, is_mfa_verified, expires_at, created_at, last_used_at
		FROM _v_sessions
		WHERE user_id = $1 AND expires_at > NOW()
		ORDER BY last_used_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var sess Session
		err := rows.Scan(&sess.ID, &sess.UserID, &sess.IPAddress, &sess.UserAgent, &sess.IsMFAVerified, &sess.ExpiresAt, &sess.CreatedAt, &sess.LastUsedAt)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, sess)
	}
	return sessions, nil
}

// RevokeSession deletes a session
func (s *AuthService) RevokeSession(ctx context.Context, sessionID, userID string) error {
	_, err := s.db.Pool.Exec(ctx, `
		DELETE FROM _v_sessions
		WHERE id = $1 AND user_id = $2
	`, sessionID, userID)
	return err
}

// RevokeAllSessions deletes all active sessions (incident response operation).
func (s *AuthService) RevokeAllSessions(ctx context.Context) error {
	_, err := s.db.Pool.Exec(ctx, `DELETE FROM _v_sessions`)
	return err
}
