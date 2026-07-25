package api

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// GetSystemStatus checks if the system is initialized (has an admin user).
func (h *Handler) GetSystemStatus(c echo.Context) error {
	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "System service unavailable"})
	}

	var count int
	err := h.DB.Pool.QueryRow(c.Request().Context(), "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&count)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to check initialization status"})
	}

	return c.JSON(http.StatusOK, map[string]bool{
		"initialized": count > 0,
	})
}
