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

func TestCSRFToken_ReturnsContextToken(t *testing.T) {
	e := echo.New()
	h := &AuthHandler{}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/csrf", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("csrf", "csrf-test-token")

	if assert.NoError(t, h.CSRFToken(c)) {
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.JSONEq(t, `{"csrf_token":"csrf-test-token"}`, rec.Body.String())
	}
}

func TestCSRFToken_FallsBackToIssuedToken(t *testing.T) {
	e := echo.New()
	h := &AuthHandler{}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/csrf", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if assert.NoError(t, h.CSRFToken(c)) {
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), "csrf_token")
		cookies := rec.Result().Cookies()
		if assert.Len(t, cookies, 1) {
			assert.Equal(t, "_ozy_csrf", cookies[0].Name)
			assert.NotEmpty(t, cookies[0].Value)
		}
	}
}

func TestRefresh_Validation(t *testing.T) {
	e := echo.New()
	h := &AuthHandler{authService: nil}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", bytes.NewBufferString(`{"refresh_token":"   "}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if assert.NoError(t, h.Refresh(c)) {
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), "refresh_token is required")
	}
}

func TestResetUserPassword_Validation(t *testing.T) {
	e := echo.New()
	h := &AuthHandler{authService: nil}

	t.Run("missing user id", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/users//reset-password", bytes.NewBufferString(`{"password":"StrongPassword123!"}`))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id")
		c.SetParamValues("")

		if assert.NoError(t, h.ResetUserPassword(c)) {
			assert.Equal(t, http.StatusBadRequest, rec.Code)
			assert.Contains(t, rec.Body.String(), "user id is required")
		}
	})

	t.Run("manual password too short", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/users/u1/reset-password", bytes.NewBufferString(`{"password":"short"}`))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id")
		c.SetParamValues("u1")

		if assert.NoError(t, h.ResetUserPassword(c)) {
			assert.Equal(t, http.StatusBadRequest, rec.Code)
			assert.Contains(t, rec.Body.String(), "at least 12")
		}
	})
}
