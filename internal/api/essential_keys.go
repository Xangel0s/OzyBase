package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

const (
	apiKeyManagedKindCustom    = "custom"
	apiKeyManagedKindEssential = "essential"
	adminVerifyScopeEssential  = "essential_api_keys"
	adminVerifyTTL             = 10 * time.Minute
	essentialAPIKeysLockKey    = int64(2026033101)
)

type EssentialAPIKeyBootstrap struct {
	AnonKey        string
	ServiceRoleKey string
}

type EssentialAPIKeySummary struct {
	ID         string     `json:"id"`
	Role       string     `json:"role"`
	Label      string     `json:"label"`
	Prefix     string     `json:"prefix"`
	CopyValue  string     `json:"copy_value,omitempty"`
	KeyVersion int        `json:"key_version"`
	IsActive   bool       `json:"is_active"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at"`
}

func buildEssentialAPIKeySummary(key APIKey, secretCiphertext string) (EssentialAPIKeySummary, error) {
	summary := EssentialAPIKeySummary{
		ID:         key.ID,
		Role:       key.Role,
		Label:      apiKeyLabel(key.Role),
		Prefix:     key.Prefix,
		KeyVersion: key.KeyVersion,
		IsActive:   key.IsActive,
		CreatedAt:  key.CreatedAt,
		LastUsedAt: key.LastUsedAt,
	}
	if key.Role != APIKeyRoleAnon {
		return summary, nil
	}
	if strings.TrimSpace(secretCiphertext) == "" {
		return summary, nil
	}

	copyValue, err := decryptKeyMaterial(apiKeySecretEncryptionSecret(), secretCiphertext)
	if err != nil {
		return EssentialAPIKeySummary{}, err
	}
	summary.CopyValue = copyValue
	return summary, nil
}

type adminVerificationClaims struct {
	Scope string `json:"scope"`
	jwt.RegisteredClaims
}

func apiKeyLabel(role string) string {
	switch role {
	case APIKeyRoleAnon:
		return "Publishable key"
	case APIKeyRoleServiceRole:
		return "Secret key"
	default:
		return role
	}
}

func apiKeySecretEncryptionSecret() string {
	if secret := strings.TrimSpace(os.Getenv("OZY_API_KEY_ENCRYPTION_SECRET")); secret != "" {
		return secret
	}
	return strings.TrimSpace(os.Getenv("JWT_SECRET"))
}

func adminVerificationSecret() string {
	if secret := strings.TrimSpace(os.Getenv("OZY_ADMIN_REAUTH_SECRET")); secret != "" {
		return secret
	}
	return strings.TrimSpace(os.Getenv("JWT_SECRET"))
}

func deriveKeyMaterialKey(secret string) ([]byte, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, errors.New("missing encryption secret")
	}
	sum := sha256.Sum256([]byte(secret))
	return sum[:], nil
}

func encryptKeyMaterial(secret, plaintext string) (string, error) {
	key, err := deriveKeyMaterialKey(secret)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func decryptKeyMaterial(secret, ciphertext string) (string, error) {
	key, err := deriveKeyMaterialKey(secret)
	if err != nil {
		return "", err
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimSpace(ciphertext))
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("ciphertext is too short")
	}
	nonce := raw[:gcm.NonceSize()]
	payload := raw[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, payload, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func managedAPIKeyPrefix(role, fullKey string) string {
	fullKey = strings.TrimSpace(fullKey)
	if fullKey == "" {
		return ""
	}
	switch role {
	case APIKeyRoleAnon:
		return "ozy_anon"
	case APIKeyRoleServiceRole:
		return "ozy_service_role"
	default:
		if len(fullKey) <= 10 {
			return fullKey
		}
		return fullKey[:10]
	}
}

func isPlaceholderKeyMaterial(value string) bool {
	clean := strings.ToLower(strings.TrimSpace(value))
	if clean == "" {
		return false
	}

	markers := []string{
		"replace-with",
		"your-password",
		"changeme",
		"example",
		"dummy",
		"mock",
	}
	for _, marker := range markers {
		if strings.Contains(clean, marker) {
			return true
		}
	}
	return false
}

func generateManagedAPIKey(role string) (string, string, error) {
	rawKey, err := GenerateRandomKey()
	if err != nil {
		return "", "", err
	}
	marker := "a"
	if role == APIKeyRoleServiceRole {
		marker = "s"
	}
	prefix := fmt.Sprintf("ozy%s_%s", marker, rawKey[:4])
	return fmt.Sprintf("%s_%s", prefix, rawKey), prefix, nil
}

func issueAdminVerificationToken(secret, userID, scope string, now time.Time, ttl time.Duration) (string, time.Time, error) {
	expiresAt := now.Add(ttl)
	claims := adminVerificationClaims{
		Scope: scope,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expiresAt, nil
}

func validateAdminVerificationToken(secret, tokenString, userID, scope string, now time.Time) error {
	claims := adminVerificationClaims{}
	token, err := jwt.ParseWithClaims(tokenString, &claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method %v", token.Header["alg"])
		}
		return []byte(secret), nil
	}, jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil {
		return err
	}
	if !token.Valid {
		return errors.New("verification token is invalid")
	}
	if claims.Scope != scope {
		return errors.New("verification token scope is invalid")
	}
	if strings.TrimSpace(claims.Subject) != strings.TrimSpace(userID) {
		return errors.New("verification token subject mismatch")
	}
	return nil
}

func verifyAdminPassword(ctx context.Context, db *data.DB, userID string, password string) error {
	userID = strings.TrimSpace(userID)
	password = strings.TrimSpace(password)
	if userID == "" || password == "" {
		return errors.New("password is required")
	}
	if _, err := uuid.Parse(userID); err != nil {
		return errors.New("invalid admin session")
	}

	var passwordHash string
	var role string
	if err := db.Pool.QueryRow(ctx, `
		SELECT password_hash, role
		FROM _v_users
		WHERE id = $1
	`, userID).Scan(&passwordHash, &role); err != nil {
		if err == pgx.ErrNoRows {
			return errors.New("admin account not found")
		}
		return err
	}
	if role != "admin" {
		return errors.New("admin privileges required")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return errors.New("invalid password")
	}
	return nil
}

func normalizeEssentialRole(raw string) (string, error) {
	role := strings.ToLower(strings.TrimSpace(raw))
	switch role {
	case APIKeyRoleAnon, APIKeyRoleServiceRole:
		return role, nil
	default:
		return "", errors.New("role must be 'anon' or 'service_role'")
	}
}

func (h *Handler) currentEssentialAPIKey(ctx context.Context, role string) (APIKey, string, error) {
	var key APIKey
	var secretCiphertext string
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT id, name, prefix, role, is_active, created_at, last_used_at, key_version, COALESCE(secret_ciphertext, '')
		FROM _v_api_keys
		WHERE role = $1
		  AND managed_kind = $2
		  AND is_active = TRUE
		  AND revoked_at IS NULL
		  AND rotated_to_key_id IS NULL
		ORDER BY key_version DESC, created_at DESC
		LIMIT 1
	`, role, apiKeyManagedKindEssential).Scan(&key.ID, &key.Name, &key.Prefix, &key.Role, &key.IsActive, &key.CreatedAt, &key.LastUsedAt, &key.KeyVersion, &secretCiphertext)
	if err != nil {
		return APIKey{}, "", err
	}
	return key, secretCiphertext, nil
}

func (h *Handler) ListEssentialAPIKeys(c echo.Context) error {
	ctx := c.Request().Context()
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT id, name, prefix, role, is_active, created_at, last_used_at, key_version,
		       CASE WHEN role = $4 THEN COALESCE(secret_ciphertext, '') ELSE '' END
		FROM _v_api_keys
		WHERE managed_kind = $1
		  AND is_active = TRUE
		  AND revoked_at IS NULL
		  AND rotated_to_key_id IS NULL
		  AND role IN ($2, $3)
		ORDER BY CASE role WHEN 'anon' THEN 0 ELSE 1 END, created_at DESC
	`, apiKeyManagedKindEssential, APIKeyRoleAnon, APIKeyRoleServiceRole, APIKeyRoleAnon)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load essential api keys"})
	}
	defer rows.Close()

	keys := make([]EssentialAPIKeySummary, 0, 2)
	for rows.Next() {
		var key APIKey
		var label string
		var secretCiphertext string
		if scanErr := rows.Scan(&key.ID, &label, &key.Prefix, &key.Role, &key.IsActive, &key.CreatedAt, &key.LastUsedAt, &key.KeyVersion, &secretCiphertext); scanErr != nil {
			continue
		}
		item, buildErr := buildEssentialAPIKeySummary(key, secretCiphertext)
		if buildErr != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load essential api keys"})
		}
		keys = append(keys, item)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"verification_required": true,
		"keys":                  keys,
	})
}

func (h *Handler) VerifyEssentialAPIKeyAccess(c echo.Context) error {
	userID, _ := c.Get("user_id").(string)
	var req struct {
		Password string `json:"password"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	if err := verifyAdminPassword(c.Request().Context(), h.DB, userID, req.Password); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": err.Error()})
	}

	signingSecret := adminVerificationSecret()
	now := time.Now().UTC()
	token, expiresAt, err := issueAdminVerificationToken(signingSecret, userID, adminVerifyScopeEssential, now, adminVerifyTTL)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to issue verification token"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"verification_token": token,
		"verified_until":     expiresAt,
		"ttl_seconds":        int(adminVerifyTTL.Seconds()),
	})
}

func (h *Handler) RevealEssentialAPIKey(c echo.Context) error {
	userID, _ := c.Get("user_id").(string)
	role, err := normalizeEssentialRole(c.Param("role"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	var req struct {
		VerificationToken string `json:"verification_token"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	if err := validateAdminVerificationToken(adminVerificationSecret(), req.VerificationToken, userID, adminVerifyScopeEssential, time.Now().UTC()); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "admin verification expired; confirm password again"})
	}

	currentKey, ciphertext, err := h.currentEssentialAPIKey(c.Request().Context(), role)
	if err != nil {
		if err == pgx.ErrNoRows {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "essential api key not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load essential api key"})
	}
	if strings.TrimSpace(ciphertext) == "" {
		return c.JSON(http.StatusConflict, map[string]string{"error": "essential api key material is unavailable"})
	}

	keyMaterial, err := decryptKeyMaterial(apiKeySecretEncryptionSecret(), ciphertext)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to decrypt essential api key"})
	}

	payload := map[string]any{
		"id":           currentKey.ID,
		"role":         currentKey.Role,
		"label":        apiKeyLabel(currentKey.Role),
		"key":          keyMaterial,
		"prefix":       currentKey.Prefix,
		"key_version":  currentKey.KeyVersion,
		"created_at":   currentKey.CreatedAt,
		"last_used_at": currentKey.LastUsedAt,
	}
	return c.JSON(http.StatusOK, payload)
}

func (h *Handler) RotateEssentialAPIKey(c echo.Context) error {
	userID, _ := c.Get("user_id").(string)
	role, err := normalizeEssentialRole(c.Param("role"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	var req struct {
		VerificationToken string `json:"verification_token"`
		Reason            string `json:"reason"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	if err := validateAdminVerificationToken(adminVerificationSecret(), req.VerificationToken, userID, adminVerifyScopeEssential, time.Now().UTC()); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "admin verification expired; confirm password again"})
	}

	ctx := c.Request().Context()
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start transaction"})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var currentID, currentPrefix, keyGroupID string
	var currentVersion int
	var workspaceID *string
	if err := tx.QueryRow(ctx, `
		SELECT id, prefix, COALESCE(key_group_id::text, ''), key_version, workspace_id
		FROM _v_api_keys
		WHERE role = $1
		  AND managed_kind = $2
		  AND is_active = TRUE
		  AND revoked_at IS NULL
		  AND rotated_to_key_id IS NULL
		ORDER BY key_version DESC, created_at DESC
		LIMIT 1
		FOR UPDATE
	`, role, apiKeyManagedKindEssential).Scan(&currentID, &currentPrefix, &keyGroupID, &currentVersion, &workspaceID); err != nil {
		if err == pgx.ErrNoRows {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "essential api key not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to lock essential api key"})
	}
	if strings.TrimSpace(keyGroupID) == "" {
		keyGroupID = currentID
	}

	newKey, prefix, err := generateManagedAPIKey(role)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to generate key"})
	}
	ciphertext, err := encryptKeyMaterial(apiKeySecretEncryptionSecret(), newKey)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to protect key material"})
	}
	hash := sha256.Sum256([]byte(newKey))
	keyHash := hex.EncodeToString(hash[:])
	newVersion := currentVersion + 1
	newID := uuid.NewString()

	var actorUserIDVal any
	if actor := actorUserIDFromContext(c); actor != nil {
		actorUserIDVal = *actor
	}
	var workspaceIDVal any
	if workspaceID != nil && strings.TrimSpace(*workspaceID) != "" {
		workspaceIDVal = *workspaceID
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO _v_api_keys (id, name, key_hash, prefix, role, is_active, created_by_user_id, key_group_id, key_version, valid_after, workspace_id, managed_kind, secret_ciphertext)
		VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, $8, NOW(), $9, $10, $11)
	`, newID, apiKeyLabel(role), keyHash, prefix, role, actorUserIDVal, keyGroupID, newVersion, workspaceIDVal, apiKeyManagedKindEssential, ciphertext); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create rotated key"})
	}

	if _, err := tx.Exec(ctx, `
		UPDATE _v_api_keys
		SET rotated_to_key_id = $2,
		    grace_until = NULL,
		    is_active = FALSE,
		    revoked_at = NOW()
		WHERE id = $1
	`, currentID, newID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to revoke previous key"})
	}

	if _, err := tx.Exec(ctx, `
		UPDATE _v_api_keys
		SET is_active = TRUE
		WHERE id = $1
	`, newID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to activate rotated key"})
	}

	details := map[string]any{
		"old_id":         currentID,
		"new_id":         newID,
		"old_prefix":     currentPrefix,
		"new_prefix":     prefix,
		"role":           role,
		"key_group_id":   keyGroupID,
		"old_version":    currentVersion,
		"new_version":    newVersion,
		"reason":         strings.TrimSpace(req.Reason),
		"rotation_model": "immediate_cutover",
	}
	detailsJSON, _ := json.Marshal(details)
	if _, err := tx.Exec(ctx, `
		INSERT INTO _v_api_key_events (api_key_id, workspace_id, action, actor_user_id, details)
		VALUES ($1, $2, 'rotate', $3, $4::jsonb)
	`, newID, workspaceIDVal, actorUserIDVal, string(detailsJSON)); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to audit rotation"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit key rotation"})
	}

	payload := map[string]any{
		"id":                newID,
		"role":              role,
		"label":             apiKeyLabel(role),
		"key":               newKey,
		"prefix":            prefix,
		"key_version":       newVersion,
		"previous_key_id":   currentID,
		"previous_disabled": true,
		"warning":           "Rotation complete. The previous key stopped working immediately.",
	}
	return c.JSON(http.StatusOK, payload)
}

func RotateEssentialAPIKeyCore(ctx context.Context, db *data.DB, role string) (string, error) {
	if db == nil || db.Pool == nil {
		return "", errors.New("database connection is required")
	}
	role = strings.ToLower(strings.TrimSpace(role))
	if role != APIKeyRoleAnon && role != APIKeyRoleServiceRole {
		return "", fmt.Errorf("invalid essential key role: %s", role)
	}

	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to start transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var currentID, currentPrefix, keyGroupID string
	var currentVersion int
	var workspaceID *string
	if err := tx.QueryRow(ctx, `
		SELECT id, prefix, COALESCE(key_group_id::text, ''), key_version, workspace_id
		FROM _v_api_keys
		WHERE role = $1
		  AND (is_active = TRUE OR revoked_at IS NULL)
		ORDER BY is_active DESC, key_version DESC, created_at DESC
		LIMIT 1
		FOR UPDATE
	`, role).Scan(&currentID, &currentPrefix, &keyGroupID, &currentVersion, &workspaceID); err != nil {
		if err == pgx.ErrNoRows {
			// If no row exists at all for this role, we can create an initial essential key
			currentVersion = 0
		} else {
			return "", fmt.Errorf("failed to lock essential api key: %w", err)
		}
	}
	if strings.TrimSpace(keyGroupID) == "" {
		keyGroupID = currentID
	}

	newKey, prefix, err := generateManagedAPIKey(role)
	if err != nil {
		return "", fmt.Errorf("failed to generate key: %w", err)
	}
	ciphertext, err := encryptKeyMaterial(apiKeySecretEncryptionSecret(), newKey)
	if err != nil {
		return "", fmt.Errorf("failed to protect key material: %w", err)
	}
	hash := sha256.Sum256([]byte(newKey))
	keyHash := hex.EncodeToString(hash[:])
	newVersion := currentVersion + 1
	newID := uuid.NewString()

	var workspaceIDVal any
	if workspaceID != nil && strings.TrimSpace(*workspaceID) != "" {
		workspaceIDVal = *workspaceID
	}

	// Deactivate ALL existing active essential keys for this role to satisfy idx_api_keys_active_essential_role
	if _, err := tx.Exec(ctx, `
		UPDATE _v_api_keys
		SET is_active = FALSE,
		    revoked_at = NOW(),
		    grace_until = NULL
		WHERE role = $1 AND managed_kind = $2 AND (is_active = TRUE OR revoked_at IS NULL)
	`, role, apiKeyManagedKindEssential); err != nil {
		return "", fmt.Errorf("failed to deactivate previous key(s): %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO _v_api_keys (id, name, key_hash, prefix, role, is_active, key_group_id, key_version, valid_after, workspace_id, managed_kind, secret_ciphertext)
		VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, NOW(), $8, $9, $10)
	`, newID, apiKeyLabel(role), keyHash, prefix, role, keyGroupID, newVersion, workspaceIDVal, apiKeyManagedKindEssential, ciphertext); err != nil {
		return "", fmt.Errorf("failed to create rotated key: %w", err)
	}

	if currentID != "" {
		if _, err := tx.Exec(ctx, `
			UPDATE _v_api_keys
			SET rotated_to_key_id = $2
			WHERE id = $1
		`, currentID, newID); err != nil {
			return "", fmt.Errorf("failed to link rotated key: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("failed to commit key rotation: %w", err)
	}

	secretFile := ".ozy_anon_key"
	if role == APIKeyRoleServiceRole {
		secretFile = ".ozy_service_role_key"
	}
	_ = os.WriteFile(secretFile, []byte(newKey), 0600)

	return newKey, nil
}

func EnsureEssentialAPIKeys(ctx context.Context, db *data.DB, bootstrap EssentialAPIKeyBootstrap) error {
	if db == nil || db.Pool == nil {
		return errors.New("database is required")
	}
	encryptionSecret := apiKeySecretEncryptionSecret()
	if strings.TrimSpace(encryptionSecret) == "" {
		return errors.New("JWT_SECRET or OZY_API_KEY_ENCRYPTION_SECRET is required for essential api keys")
	}

	specs := []struct {
		role       string
		key        string
		secretFile string
	}{
		{role: APIKeyRoleAnon, key: strings.TrimSpace(bootstrap.AnonKey), secretFile: ".ozy_anon_key"},
		{role: APIKeyRoleServiceRole, key: strings.TrimSpace(bootstrap.ServiceRoleKey), secretFile: ".ozy_service_role_key"},
	}

	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", essentialAPIKeysLockKey); err != nil {
		return err
	}

	for _, spec := range specs {
		// 1. Determine effective key material
		targetKey := spec.key
		if targetKey == "" || isPlaceholderKeyMaterial(targetKey) {
			if data, readErr := os.ReadFile(spec.secretFile); readErr == nil {
				targetKey = strings.TrimSpace(string(data))
			}
		}

		// 2. Compute hash if targetKey is non-empty
		var targetHash string
		if targetKey != "" {
			hash := sha256.Sum256([]byte(targetKey))
			targetHash = hex.EncodeToString(hash[:])
		}

		// 3. Query existing active essential key for this role in DB (matching by role and essential kind)
		var (
			currentID         string
			currentHash       string
			currentCiphertext string
			currentVersion    int
		)
		scanErr := tx.QueryRow(ctx, `
			SELECT id, key_hash, COALESCE(secret_ciphertext, ''), key_version
			FROM _v_api_keys
			WHERE role = $1
			  AND managed_kind = $2
			  AND (is_active = TRUE OR revoked_at IS NULL)
			ORDER BY is_active DESC, key_version DESC, created_at DESC
			LIMIT 1
			FOR UPDATE
		`, spec.role, apiKeyManagedKindEssential).Scan(&currentID, &currentHash, &currentCiphertext, &currentVersion)

		if scanErr == nil && targetHash != "" && currentHash == targetHash {
			// DB hash matches file/env key hash perfectly. Ensure managed_kind and local secret file are in sync.
			_, _ = tx.Exec(ctx, `UPDATE _v_api_keys SET managed_kind = $2, is_active = TRUE, revoked_at = NULL WHERE id = $1`, currentID, apiKeyManagedKindEssential)
			_ = os.WriteFile(spec.secretFile, []byte(targetKey), 0600)
			continue
		}

		// 4. If DB has an active key but targetKey was empty, attempt decrypting DB key
		if scanErr == nil && targetKey == "" && strings.TrimSpace(currentCiphertext) != "" {
			if decrypted, decErr := decryptKeyMaterial(encryptionSecret, currentCiphertext); decErr == nil && decrypted != "" {
				targetKey = decrypted
				hash := sha256.Sum256([]byte(targetKey))
				targetHash = hex.EncodeToString(hash[:])
				_ = os.WriteFile(spec.secretFile, []byte(targetKey), 0600)
				continue
			}
		}

		// 5. If targetKey is still empty or placeholder, generate a fresh managed key
		if targetKey == "" || isPlaceholderKeyMaterial(targetKey) {
			genKey, _, genErr := generateManagedAPIKey(spec.role)
			if genErr != nil {
				return genErr
			}
			targetKey = genKey
			hash := sha256.Sum256([]byte(targetKey))
			targetHash = hex.EncodeToString(hash[:])
		}

		// 6. Encrypt targetKey and prepare DB record
		ciphertext, encErr := encryptKeyMaterial(encryptionSecret, targetKey)
		if encErr != nil {
			return encErr
		}

		prefix := managedAPIKeyPrefix(spec.role, targetKey)

		var existingHashID string
		if targetHash != "" {
			_ = tx.QueryRow(ctx, `SELECT id::text FROM _v_api_keys WHERE key_hash = $1 LIMIT 1`, targetHash).Scan(&existingHashID)
		}

		targetID := existingHashID
		if targetID == "" {
			targetID = currentID
		}

		// 7. Deactivate all OTHER essential keys for this role first to respect idx_api_keys_active_essential_role
		if targetID != "" {
			_, _ = tx.Exec(ctx, `
				UPDATE _v_api_keys
				SET is_active = FALSE,
				    revoked_at = NOW()
				WHERE role = $1 AND managed_kind = $2 AND id != $3
			`, spec.role, apiKeyManagedKindEssential, targetID)

			if _, execErr := tx.Exec(ctx, `
				UPDATE _v_api_keys
				SET key_hash = $2,
				    prefix = $3,
				    is_active = TRUE,
				    revoked_at = NULL,
				    valid_after = NOW(),
				    managed_kind = $4,
				    secret_ciphertext = $5
				WHERE id = $1
			`, targetID, targetHash, prefix, apiKeyManagedKindEssential, ciphertext); execErr != nil {
				return execErr
			}
		} else {
			_, _ = tx.Exec(ctx, `
				UPDATE _v_api_keys
				SET is_active = FALSE,
				    revoked_at = NOW()
				WHERE role = $1 AND managed_kind = $2
			`, spec.role, apiKeyManagedKindEssential)

			newID := uuid.NewString()
			newVersion := currentVersion + 1
			keyGroupID := newID

			if _, execErr := tx.Exec(ctx, `
				INSERT INTO _v_api_keys (id, name, key_hash, prefix, role, is_active, key_group_id, key_version, valid_after, managed_kind, secret_ciphertext)
				VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, NOW(), $8, $9)
			`, newID, apiKeyLabel(spec.role), targetHash, prefix, spec.role, keyGroupID, newVersion, apiKeyManagedKindEssential, ciphertext); execErr != nil {
				return execErr
			}
		}

		// Update local secret file
		_ = os.WriteFile(spec.secretFile, []byte(targetKey), 0600)
	}

	return tx.Commit(ctx)
}
