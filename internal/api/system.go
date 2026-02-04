package api

import (
	"encoding/json"
	"net/http"

	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

// GetSystemStatus checks if the system is initialized (has an admin user)
func (h *Handler) GetSystemStatus(c echo.Context) error {
	var count int
	// Check if any user with admin role exists
	err := h.DB.Pool.QueryRow(c.Request().Context(), "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&count)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]bool{
		"initialized": count > 0,
	})
}

// SetupSystem handles the initial setup (First Time Run)
func (h *Handler) SetupSystem(c echo.Context) error {
	var req struct {
		Email        string `json:"email"`
		Password     string `json:"password"`
		Mode         string `json:"mode"`          // "clean" or "secure"
		AllowCountry string `json:"allow_country"` // Current country to allow if secure mode
	}

	if err := c.Bind(&req); err != nil {
		return err
	}

	// 1. Validate no admin exists (Double check for security)
	var count int
	_ = h.DB.Pool.QueryRow(c.Request().Context(), "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&count)
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
	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_users (email, password_hash, role)
		VALUES ($1, $2, 'admin')
		RETURNING id
	`, req.Email, hashedPassword).Scan(&userID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create admin: " + err.Error()})
	}

	// 2.5 Generate Token for immediate login
	// Note: h.Auth provided via main.go
	token, err := h.Auth.GenerateTokenForUser(userID, "admin")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate session token"})
	}

	// 3. Apply Configuration based on Mode
	if req.Mode == "secure" {
		// A. Enable Geo-Fencing for the provided country
		if req.AllowCountry != "" {
			config := map[string]any{
				"enabled":           true,
				"allowed_countries": []string{req.AllowCountry},
			}
			configJSON, _ := json.Marshal(config)

			_, _ = h.DB.Pool.Exec(c.Request().Context(), `
				INSERT INTO _v_security_policies (type, config)
				VALUES ('geo_fencing', $1)
				ON CONFLICT (type) DO UPDATE SET config = $1
			`, configJSON)
		}

		// Security: Initialize logs
		_, _ = h.DB.Pool.Exec(c.Request().Context(), `
			INSERT INTO _v_audit_logs (method, path, status, country) 
			VALUES ('SYSTEM', 'SETUP_SECURE', 200, 'SYSTEM')
		`)
	}

	return c.JSON(http.StatusOK, map[string]string{
		"status": "initialized",
		"token":  token,
	})
}
