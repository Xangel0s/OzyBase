package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

type setupAction struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Detail string `json:"detail"`
}

type setupSystemResponse struct {
	Status              string        `json:"status"`
	Token               string        `json:"token"`
	Mode                string        `json:"mode"`
	Summary             string        `json:"summary"`
	AppliedActions      []setupAction `json:"applied_actions"`
	PreservedTableCount int           `json:"preserved_table_count,omitempty"`
	MigratedTableCount  int           `json:"migrated_table_count,omitempty"`
	ImportedRowCount    int           `json:"imported_row_count,omitempty"`
	MigrationWarnings   []string      `json:"migration_warnings,omitempty"`
}

// GetSystemStatus checks if the system is initialized (has an admin user)
func (h *Handler) GetSystemStatus(c echo.Context) error {
	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "System service unavailable"})
	}

	var count int
	// Check if any user with admin role exists
	err := h.DB.Pool.QueryRow(c.Request().Context(), "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&count)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to check initialization status"})
	}

	return c.JSON(http.StatusOK, map[string]bool{
		"initialized": count > 0,
	})
}

// SetupSystem handles the initial setup (First Time Run)
func (h *Handler) SetupSystem(c echo.Context) error {
	var req struct {
		Email        string                 `json:"email"`
		Password     string                 `json:"password"`
		Mode         string                 `json:"mode"`          // "clean", "secure", or "migrate"
		AllowCountry string                 `json:"allow_country"` // Current country to allow if secure mode
		Migration    *setupMigrationRequest `json:"migration,omitempty"`
	}

	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Mode = strings.TrimSpace(strings.ToLower(req.Mode))
	req.AllowCountry = strings.TrimSpace(req.AllowCountry)

	if req.Email == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Email is required"})
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid email format"})
	}
	if len(req.Password) < 12 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Password must be at least 12 characters"})
	}
	if req.Mode == "" {
		req.Mode = "clean"
	}
	if req.Mode != "clean" && req.Mode != "secure" && req.Mode != "migrate" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid mode. Allowed: clean, secure, migrate"})
	}

	var migrationPlan setupMigrationPlan
	if req.Mode == "migrate" {
		if req.Migration == nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Migration payload is required for migrate mode"})
		}
		normalizeSetupMigrationRequest(req.Migration)
		if err := validateSetupMigrationRequest(*req.Migration); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		plan, err := buildSetupMigrationPlan(*req.Migration)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		migrationPlan = plan
	}
	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "System service unavailable"})
	}
	if h.Auth == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Auth service unavailable"})
	}

	// Start transaction for atomic setup
	tx, err := h.DB.Pool.Begin(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to start transaction"})
	}
	defer func() { _ = tx.Rollback(c.Request().Context()) }()

	// Serialize bootstrap to avoid concurrent double initialization.
	if _, err := tx.Exec(c.Request().Context(), "LOCK TABLE _v_users IN ACCESS EXCLUSIVE MODE"); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to acquire setup lock"})
	}

	// Validate no admin exists (inside locked transaction)
	var count int
	if err := tx.QueryRow(c.Request().Context(), "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&count); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to verify initialization state"})
	}
	if count > 0 {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "System already initialized"})
	}

	// 2. Create Admin User
	hashedBytes, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to hash password"})
	}
	hashedPassword := string(hashedBytes)

	var userID string
	err = tx.QueryRow(c.Request().Context(), `
		INSERT INTO _v_users (email, password_hash, role)
		VALUES ($1, $2, 'admin')
		RETURNING id
	`, req.Email, hashedPassword).Scan(&userID)

	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return c.JSON(http.StatusConflict, map[string]string{"error": "Admin user already exists"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create admin"})
	}

	// 3. Apply configuration based on mode
	allowedCountries := []string{}
	preservedTableCount := 0
	migrationResult := setupMigrationApplyResult{}
	switch req.Mode {
	case "secure":
		// A. Enable Geo-Fencing for the provided country
		if req.AllowCountry != "" {
			allowedCountries = normalizeAllowedCountries([]string{req.AllowCountry})
			config := map[string]any{
				"enabled":           true,
				"allowed_countries": allowedCountries,
			}
			configJSON, err := json.Marshal(config)
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to encode security policy"})
			}

			_, err = tx.Exec(c.Request().Context(), `
				INSERT INTO _v_security_policies (type, config)
				VALUES ('geo_fencing', $1)
				ON CONFLICT (type) DO UPDATE SET config = $1
			`, configJSON)
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to apply security policy"})
			}
		}

		// Security: Initialize logs
		_, err = tx.Exec(c.Request().Context(), `
			INSERT INTO _v_audit_logs (method, path, status, country)
			VALUES ('SYSTEM', 'SETUP_SECURE', 200, 'SYSTEM')
		`)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to initialize audit logs"})
		}
	case "migrate":
		migrationResult, err = applySetupMigration(c.Request().Context(), tx, migrationPlan)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}

		_, err = tx.Exec(c.Request().Context(), `
			INSERT INTO _v_audit_logs (method, path, status, country)
			VALUES ('SYSTEM', 'SETUP_MIGRATE', 200, 'SYSTEM')
		`)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to initialize migration setup logs"})
		}
	}

	// 4. Generate token and create session inside the setup transaction so bootstrap is atomic.
	token, err := h.Auth.GenerateTokenOnly(userID, "admin")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate session token"})
	}

	tokenHashRaw := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(tokenHashRaw[:])
	_, err = tx.Exec(c.Request().Context(), `
		INSERT INTO _v_sessions (user_id, token_hash, ip_address, user_agent, is_mfa_verified, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, userID, tokenHash, c.RealIP(), c.Request().UserAgent(), false, time.Now().Add(72*time.Hour))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to initialize admin session"})
	}

	// Commit transaction
	if err := tx.Commit(c.Request().Context()); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to commit setup"})
	}

	return c.JSON(http.StatusOK, buildSetupResponse(req.Mode, token, allowedCountries, preservedTableCount, migrationResult))
}

func countPreservedUserTables(ctx context.Context, tx pgx.Tx) (int, error) {
	var count int
	err := tx.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM information_schema.tables
		WHERE table_schema = 'public'
		  AND table_type = 'BASE TABLE'
		  AND table_name NOT LIKE '\_v\_%' ESCAPE '\'
	`).Scan(&count)
	return count, err
}

func buildSetupResponse(mode, token string, allowedCountries []string, preservedTableCount int, migrationResult setupMigrationApplyResult) setupSystemResponse {
	actions := []setupAction{
		{
			Key:    "admin_account",
			Label:  "Admin account created",
			Detail: "The first administrator user was created for this workspace bootstrap.",
		},
		{
			Key:    "admin_session",
			Label:  "Admin session initialized",
			Detail: "A signed bootstrap session was created so the first login can continue immediately.",
		},
	}

	summary := "Admin bootstrap completed without extra presets."

	switch mode {
	case "secure":
		geoDetail := "Geo-fencing audit mode was recorded, but no country was detected for the initial allowlist."
		summary = "Admin bootstrap completed with the secure preset."
		if len(allowedCountries) > 0 {
			geoDetail = fmt.Sprintf("Geo-fencing was enabled with %s as the initial allowed country.", allowedCountries[0])
			summary = fmt.Sprintf("Admin bootstrap completed with geo-fencing seeded for %s.", allowedCountries[0])
		}
		actions = append(actions,
			setupAction{
				Key:    "geo_fencing",
				Label:  "Geo-fencing preset applied",
				Detail: geoDetail,
			},
			setupAction{
				Key:    "secure_audit_log",
				Label:  "Secure bootstrap audit logged",
				Detail: "The secure initialization event was written to the audit log.",
			},
		)
	case "migrate":
		tableLabel := "tables"
		rowLabel := "rows"
		if migrationResult.MigratedTableCount == 1 {
			tableLabel = "table"
		}
		if migrationResult.ImportedRowCount == 1 {
			rowLabel = "row"
		}
		summary = fmt.Sprintf("Admin bootstrap completed with %d migrated %s and %d imported %s.", migrationResult.MigratedTableCount, tableLabel, migrationResult.ImportedRowCount, rowLabel)
		actions = append(actions,
			setupAction{
				Key:    "migration_plan_applied",
				Label:  "Migration plan applied",
				Detail: fmt.Sprintf("%d migrated %s were prepared during bootstrap.", migrationResult.MigratedTableCount, tableLabel),
			},
			setupAction{
				Key:    "migration_rows_imported",
				Label:  "Initial dataset imported",
				Detail: fmt.Sprintf("%d %s were inserted into the migrated tables.", migrationResult.ImportedRowCount, rowLabel),
			},
			setupAction{
				Key:    "migration_audit_log",
				Label:  "Migration bootstrap audit logged",
				Detail: "A migration-mode setup marker was written for traceability.",
			},
		)
		for _, warning := range migrationResult.Warnings {
			actions = append(actions, setupAction{
				Key:    "migration_warning",
				Label:  "Migration warning",
				Detail: warning,
			})
		}
	default:
		actions = append(actions, setupAction{
			Key:    "manual_baseline",
			Label:  "Manual baseline preserved",
			Detail: "No extra security presets or data migration steps were applied during bootstrap.",
		})
	}

	return setupSystemResponse{
		Status:              "initialized",
		Token:               token,
		Mode:                mode,
		Summary:             summary,
		AppliedActions:      actions,
		PreservedTableCount: preservedTableCount,
		MigratedTableCount:  migrationResult.MigratedTableCount,
		ImportedRowCount:    migrationResult.ImportedRowCount,
		MigrationWarnings:   uniqueStrings(migrationResult.Warnings),
	}
}
