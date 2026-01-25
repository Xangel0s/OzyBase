package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
)

func TestSignup_Validation(t *testing.T) {
	// Setup
	e := echo.New()
	h := &AuthHandler{authService: nil} // We don't need the service if validation fails early

	t.Run("Invalid Email Format", func(t *testing.T) {
		reqBody := map[string]string{
			"email":    "invalid-email",
			"password": "password123",
		}
		body, _ := json.Marshal(reqBody)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewBuffer(body))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		if assert.NoError(t, h.Signup(c)) {
			assert.Equal(t, http.StatusBadRequest, rec.Code)
			assert.Contains(t, rec.Body.String(), "invalid email format")
		}
	})

	t.Run("Short Password", func(t *testing.T) {
		reqBody := map[string]string{
			"email":    "test@example.com",
			"password": "short",
		}
		body, _ := json.Marshal(reqBody)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewBuffer(body))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		if assert.NoError(t, h.Signup(c)) {
			assert.Equal(t, http.StatusBadRequest, rec.Code)
			assert.Contains(t, rec.Body.String(), "password must be at least 8 characters long")
		}
	})
}

