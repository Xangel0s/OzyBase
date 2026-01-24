package core

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Xangel0s/FlowKore/internal/data"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type AuthService struct {
	db        *data.DB
	jwtSecret string
}

func NewAuthService(db *data.DB, jwtSecret string) *AuthService {
	return &AuthService{
		db:        db,
		jwtSecret: jwtSecret,
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
		RETURNING id, email, role, created_at, updated_at
	`, email, string(hashedPassword), "user").Scan(&user.ID, &user.Email, &user.Role, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	return &user, nil
}

// Login verifies credentials and returns a JWT
func (s *AuthService) Login(ctx context.Context, email, password string) (string, *User, error) {
	var user User
	err := s.db.Pool.QueryRow(ctx, `
		SELECT id, email, password_hash, role, created_at, updated_at
		FROM _v_users
		WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.Role, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return "", nil, errors.New("invalid email or password")
	}

	// Compare passwords
	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password))
	if err != nil {
		return "", nil, errors.New("invalid email or password")
	}

	// Generate JWT
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID,
		"role":    user.Role,
		"exp":     time.Now().Add(time.Hour * 72).Unix(),
	})

	tokenString, err := token.SignedString([]byte(s.jwtSecret))
	if err != nil {
		return "", nil, fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, &user, nil
}
