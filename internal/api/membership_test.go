package api

import (
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestWorkspaceIDFromRequestHeaders(t *testing.T) {
	e := echo.New()

	t.Run("prefers project header", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/auth/signup", nil)
		req.Header.Set("X-Ozy-Project-ID", "project-123")
		req.Header.Set("X-Workspace-Id", "workspace-456")
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		if got := workspaceIDFromRequestHeaders(c); got != "project-123" {
			t.Fatalf("expected project header, got %q", got)
		}
	})

	t.Run("falls back to workspace header", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/auth/signup", nil)
		req.Header.Set("X-Workspace-Id", "workspace-456")
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		if got := workspaceIDFromRequestHeaders(c); got != "workspace-456" {
			t.Fatalf("expected workspace header, got %q", got)
		}
	})
}
