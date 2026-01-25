package api

import (
	"context"
	"net/http"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
)

// Handler holds dependencies for HTTP handlers
type Handler struct {
	DB *data.DB
}

// NewHandler creates a new Handler with the given dependencies
func NewHandler(db *data.DB) *Handler {
	return &Handler{DB: db}
}

// HealthResponse represents the health check response
type HealthResponse struct {
	Status    string `json:"status"`
	Database  string `json:"database"`
	Timestamp string `json:"timestamp"`
}

// Health handles GET /api/health
func (h *Handler) Health(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 2*time.Second)
	defer cancel()

	dbStatus := "connected"
	if err := h.DB.Health(ctx); err != nil {
		dbStatus = "disconnected"
	}

	status := "ok"
	if dbStatus == "disconnected" {
		status = "degraded"
	}

	return c.JSON(http.StatusOK, HealthResponse{
		Status:    status,
		Database:  dbStatus,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

