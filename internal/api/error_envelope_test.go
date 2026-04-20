package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestNormalizeErrorPayloadSanitizesInternalMessages(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(requestIDContextKey, "req-test")

	payload := normalizeErrorPayload(c, http.StatusInternalServerError, map[string]any{
		"error": "SQLSTATE 25P02: current transaction is aborted",
	})

	if payload["error"] != http.StatusText(http.StatusInternalServerError) {
		t.Fatalf("expected sanitized internal error, got %#v", payload["error"])
	}
	if payload["request_id"] != "req-test" {
		t.Fatalf("expected request id to be preserved, got %#v", payload["request_id"])
	}
}

func TestNormalizeErrorPayloadKeepsMarkedPublicServerErrors(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	payload := normalizeErrorPayload(c, http.StatusInternalServerError, publicErrorPayload("Unable to sync the system schema right now.", "INTERNAL_ERROR"))

	if payload["error"] != "Unable to sync the system schema right now." {
		t.Fatalf("expected public 5xx message to be preserved, got %#v", payload["error"])
	}
	if _, ok := payload[publicErrorFlagKey]; ok {
		t.Fatalf("expected internal visibility marker to be stripped from payload")
	}
}
