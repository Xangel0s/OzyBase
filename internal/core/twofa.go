package core

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/pquerna/otp/totp"
)

type TwoFactorService struct {
	db *data.DB
}

type TwoFactorSetup struct {
	Secret      string   `json:"secret"`
	QRCodeURL   string   `json:"qr_code_url"`
	BackupCodes []string `json:"backup_codes"`
}

func NewTwoFactorService(db *data.DB) *TwoFactorService {
	return &TwoFactorService{db: db}
}

// GenerateSecret creates a new TOTP secret for a user
func (s *TwoFactorService) GenerateSecret(ctx context.Context, userID, email string) (*TwoFactorSetup, error) {
	// Generate TOTP key
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "OzyBase",
		AccountName: email,
		SecretSize:  32,
	})
	if err != nil {
		return nil, err
	}

	// Generate backup codes
	backupCodes := make([]string, 10)
	for i := 0; i < 10; i++ {
		code, err := generateBackupCode()
		if err != nil {
			return nil, err
		}
		backupCodes[i] = code
	}

	// Save to database (disabled by default until user verifies)
	_, err = s.db.Pool.Exec(ctx, `
		INSERT INTO _v_user_2fa (user_id, secret, is_enabled, backup_codes)
		VALUES ($1, $2, false, $3)
		ON CONFLICT (user_id) DO UPDATE 
		SET secret = $2, backup_codes = $3, is_enabled = false
	`, userID, key.Secret(), backupCodes)

	if err != nil {
		return nil, err
	}

	return &TwoFactorSetup{
		Secret:      key.Secret(),
		QRCodeURL:   key.URL(),
		BackupCodes: backupCodes,
	}, nil
}

// EnableTwoFactor enables 2FA after user verifies the code
func (s *TwoFactorService) EnableTwoFactor(ctx context.Context, userID, code string) error {
	var secret string
	err := s.db.Pool.QueryRow(ctx, `
		SELECT secret FROM _v_user_2fa WHERE user_id = $1
	`, userID).Scan(&secret)

	if err != nil {
		return fmt.Errorf("2FA not set up for this user")
	}

	// Verify the code
	valid := totp.Validate(code, secret)
	if !valid {
		return fmt.Errorf("invalid verification code")
	}

	// Enable 2FA
	_, err = s.db.Pool.Exec(ctx, `
		UPDATE _v_user_2fa SET is_enabled = true WHERE user_id = $1
	`, userID)

	return err
}

// DisableTwoFactor disables 2FA for a user
func (s *TwoFactorService) DisableTwoFactor(ctx context.Context, userID string) error {
	_, err := s.db.Pool.Exec(ctx, `
		DELETE FROM _v_user_2fa WHERE user_id = $1
	`, userID)
	return err
}

// VerifyCode validates a TOTP code or backup code
func (s *TwoFactorService) VerifyCode(ctx context.Context, userID, code string) (bool, error) {
	var secret string
	var isEnabled bool
	var backupCodes []string

	err := s.db.Pool.QueryRow(ctx, `
		SELECT secret, is_enabled, backup_codes FROM _v_user_2fa WHERE user_id = $1
	`, userID).Scan(&secret, &isEnabled, &backupCodes)

	if err != nil {
		return false, nil // 2FA not enabled
	}

	if !isEnabled {
		return false, nil
	}

	// Try TOTP code first
	if totp.Validate(code, secret) {
		// Update last used timestamp
		_, _ = s.db.Pool.Exec(ctx, `
			UPDATE _v_user_2fa SET last_used_at = NOW() WHERE user_id = $1
		`, userID)
		return true, nil
	}

	// Try backup codes
	for i, backupCode := range backupCodes {
		if backupCode == code {
			// Remove used backup code
			newBackupCodes := append(backupCodes[:i], backupCodes[i+1:]...)
			_, _ = s.db.Pool.Exec(ctx, `
				UPDATE _v_user_2fa SET backup_codes = $1, last_used_at = NOW() WHERE user_id = $2
			`, newBackupCodes, userID)
			return true, nil
		}
	}

	return false, nil
}

// IsEnabled checks if 2FA is enabled for a user
func (s *TwoFactorService) IsEnabled(ctx context.Context, userID string) (bool, error) {
	var isEnabled bool
	err := s.db.Pool.QueryRow(ctx, `
		SELECT is_enabled FROM _v_user_2fa WHERE user_id = $1
	`, userID).Scan(&isEnabled)

	if err != nil {
		return false, nil // Not enabled
	}

	return isEnabled, nil
}

// generateBackupCode creates a random 8-character backup code
func generateBackupCode() (string, error) {
	b := make([]byte, 5)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	code := base32.StdEncoding.EncodeToString(b)
	code = strings.ReplaceAll(code, "=", "")
	return code[:8], nil
}
