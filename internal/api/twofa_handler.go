package api

import (
	"net/http"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/labstack/echo/v4"
)

type TwoFactorHandler struct {
	service *core.TwoFactorService
}

func NewTwoFactorHandler(service *core.TwoFactorService) *TwoFactorHandler {
	return &TwoFactorHandler{service: service}
}

// Setup2FA generates a new 2FA secret and QR code
func (h *TwoFactorHandler) Setup2FA(c echo.Context) error {
	userID := c.Get("user_id").(string)
	email := c.Get("email").(string)

	setup, err := h.service.GenerateSecret(c.Request().Context(), userID, email)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, setup)
}

// Enable2FA enables 2FA after verifying the code
func (h *TwoFactorHandler) Enable2FA(c echo.Context) error {
	userID := c.Get("user_id").(string)

	var req struct {
		Code string `json:"code"`
	}

	if err := c.Bind(&req); err != nil {
		return err
	}

	if req.Code == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "code is required"})
	}

	err := h.service.EnableTwoFactor(c.Request().Context(), userID, req.Code)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "2FA enabled successfully"})
}

// Disable2FA disables 2FA for the user
func (h *TwoFactorHandler) Disable2FA(c echo.Context) error {
	userID := c.Get("user_id").(string)

	err := h.service.DisableTwoFactor(c.Request().Context(), userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "2FA disabled successfully"})
}

// Get2FAStatus returns whether 2FA is enabled for the user
func (h *TwoFactorHandler) Get2FAStatus(c echo.Context) error {
	userID := c.Get("user_id").(string)

	isEnabled, err := h.service.IsEnabled(c.Request().Context(), userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"enabled": isEnabled,
	})
}

// Verify2FA verifies a 2FA code during login
func (h *TwoFactorHandler) Verify2FA(c echo.Context) error {
	var req struct {
		UserID string `json:"user_id"`
		Code   string `json:"code"`
	}

	if err := c.Bind(&req); err != nil {
		return err
	}

	valid, err := h.service.VerifyCode(c.Request().Context(), req.UserID, req.Code)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	if !valid {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid code"})
	}

	return c.JSON(http.StatusOK, map[string]bool{"valid": true})
}
