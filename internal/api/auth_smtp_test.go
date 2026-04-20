package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSendSMTPTestEmail_RejectsConsoleFallbackWithoutConfig(t *testing.T) {
	db := setupSMTPConfigTestDB(t)
	h := &Handler{DB: db}

	body := bytes.NewBufferString(`{
		"to":"ops@example.com"
	}`)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/smtp/test", body)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.SendSMTPTestEmail(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())

	var payload map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	assert.Equal(t, "SMTP_NOT_CONFIGURED", payload["error_code"])
}

func TestUpdateSMTPSettings_PersistsManagedSecrets(t *testing.T) {
	db := setupSMTPConfigTestDB(t)
	h := &Handler{DB: db}

	body := bytes.NewBufferString(`{
		"host":"smtp.example.com",
		"port":"2525",
		"username":"demo",
		"password":"secret-token",
		"from":"alerts@example.com"
	}`)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPut, "/api/auth/smtp", body)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.UpdateSMTPSettings(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var payload SMTPSettingsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	assert.Equal(t, "smtp.example.com", payload.Host)
	assert.Equal(t, "2525", payload.Port)
	assert.Equal(t, "demo", payload.Username)
	assert.Equal(t, "alerts@example.com", payload.From)
	assert.True(t, payload.Configured)
	assert.True(t, payload.PasswordConfigured)
	assert.Equal(t, string(mailer.SMTPConfigSourceDatabase), payload.Source)

	var storedPassword string
	err = db.Pool.QueryRow(context.Background(), `
		SELECT value
		FROM _v_secrets
		WHERE key = $1
	`, mailer.SMTPSecretPasswordKey).Scan(&storedPassword)
	require.NoError(t, err)
	assert.Equal(t, "secret-token", storedPassword)
}

func TestGetAuthConfig_UsesManagedSMTPSecrets(t *testing.T) {
	t.Setenv("SMTP_HOST", "")
	t.Setenv("SMTP_PORT", "")
	t.Setenv("SMTP_USER", "")
	t.Setenv("SMTP_PASSWORD", "")
	t.Setenv("SMTP_FROM", "")

	db := setupSMTPConfigTestDB(t)
	require.NoError(t, mailer.SaveSMTPConfig(context.Background(), db, mailer.SMTPConfig{
		Host:     "smtp.runtime.test",
		Port:     "587",
		Username: "runtime-user",
		Password: "runtime-pass",
		From:     "runtime@example.com",
	}, false, false))

	h := &Handler{DB: db}
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/config", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.GetAuthConfig(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var payload AuthConfigResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	assert.True(t, payload.SMTPConfigured)
}

func TestListSecrets_HidesManagedSMTPEntries(t *testing.T) {
	db := setupSMTPConfigTestDB(t)
	require.NoError(t, mailer.SaveSMTPConfig(context.Background(), db, mailer.SMTPConfig{
		Host:     "smtp.hidden.test",
		Port:     "587",
		Username: "hidden-user",
		Password: "hidden-pass",
		From:     "hidden@example.com",
	}, false, false))
	_, err := db.Pool.Exec(context.Background(), `
		INSERT INTO _v_secrets (key, value, description)
		VALUES ('custom.api.token', 'visible', 'Visible secret')
	`)
	require.NoError(t, err)

	h := &Handler{DB: db}
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/vault", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = h.ListSecrets(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var secrets []Secret
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &secrets))
	require.Len(t, secrets, 1)
	assert.Equal(t, "custom.api.token", secrets[0].Key)
	assert.Equal(t, "visible", secrets[0].Value)
}

func TestCreateSecret_RejectsReservedSMTPKeys(t *testing.T) {
	db := setupSMTPConfigTestDB(t)
	h := &Handler{DB: db}

	body := bytes.NewBufferString(`{
		"key":"ozy.smtp.password",
		"value":"nope",
		"description":"Should be blocked"
	}`)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/vault", body)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.CreateSecret(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())

	var payload map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	assert.Equal(t, "RESERVED_SECRET_KEY", payload["error_code"])
}

func setupSMTPConfigTestDB(t *testing.T) *data.DB {
	t.Helper()

	db := setupSystemTestDB(t)
	_, err := db.Pool.Exec(context.Background(), `
		TRUNCATE TABLE
			_v_secrets
		RESTART IDENTITY CASCADE
	`)
	require.NoError(t, err)
	return db
}
