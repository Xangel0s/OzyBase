package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
)

func TestSecurityHeadersMiddleware(t *testing.T) {
	e := echo.New()
	config := DefaultSecurityConfig()

	// Add security middleware
	e.Use(SecurityHeadersMiddleware(config))

	// Add a test route
	e.GET("/test", func(c echo.Context) error {
		return c.String(http.StatusOK, "OK")
	})

	t.Run("Sets X-Content-Type-Options", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	})

	t.Run("Sets X-Frame-Options", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		assert.Equal(t, "DENY", rec.Header().Get("X-Frame-Options"))
	})

	t.Run("Sets X-XSS-Protection", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		assert.Equal(t, "1; mode=block", rec.Header().Get("X-XSS-Protection"))
	})

	t.Run("Sets Content-Security-Policy", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		csp := rec.Header().Get("Content-Security-Policy")
		assert.Contains(t, csp, "default-src 'self'")
	})

	t.Run("Sets Referrer-Policy", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		assert.Equal(t, "strict-origin-when-cross-origin", rec.Header().Get("Referrer-Policy"))
	})

	t.Run("Sets Permissions-Policy", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		assert.Equal(t, "geolocation=(), camera=(), microphone=()", rec.Header().Get("Permissions-Policy"))
	})
}

func TestDefaultSecurityConfig(t *testing.T) {
	config := DefaultSecurityConfig()

	assert.Equal(t, "DENY", config.XFrameOptions)
	assert.Equal(t, "nosniff", config.XContentTypeOptions)
	assert.Equal(t, "1; mode=block", config.XSSProtection)
	assert.Equal(t, 31536000, config.HSTSMaxAge)
	assert.True(t, config.HSTSIncludeSubdomains)
	assert.NotEmpty(t, config.ContentSecurityPolicy)
	assert.NotEmpty(t, config.ReferrerPolicy)
}

func TestConstantTimeCompare(t *testing.T) {
	t.Run("Equal strings", func(t *testing.T) {
		assert.True(t, ConstantTimeCompare("secret", "secret"))
	})

	t.Run("Different strings", func(t *testing.T) {
		assert.False(t, ConstantTimeCompare("secret", "other"))
	})

	t.Run("Different lengths", func(t *testing.T) {
		assert.False(t, ConstantTimeCompare("short", "longer"))
	})

	t.Run("Empty strings", func(t *testing.T) {
		assert.True(t, ConstantTimeCompare("", ""))
	})
}

func TestAPIVersionHeader(t *testing.T) {
	e := echo.New()

	e.Use(APIVersionHeader("1.0.0"))

	e.GET("/test", func(c echo.Context) error {
		return c.String(http.StatusOK, "OK")
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	assert.Equal(t, "1.0.0", rec.Header().Get("X-API-Version"))
}

func TestSecurityHeadersDefault(t *testing.T) {
	e := echo.New()

	// Use the convenience function
	e.Use(SecurityHeadersDefault())

	e.GET("/test", func(c echo.Context) error {
		return c.String(http.StatusOK, "OK")
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	// Should have all default security headers
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.NotEmpty(t, rec.Header().Get("X-Content-Type-Options"))
	assert.NotEmpty(t, rec.Header().Get("X-Frame-Options"))
}

