package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSetupSystem_Validation(t *testing.T) {
	e := echo.New()
	h := &Handler{}

	tests := []struct {
		name        string
		rawBody     string
		wantStatus  int
		wantContain string
	}{
		{
			name:        "invalid json body",
			rawBody:     `{"email":`,
			wantStatus:  http.StatusBadRequest,
			wantContain: "Invalid request body",
		},
		{
			name:        "missing email",
			rawBody:     `{"password":"StrongPass123!","mode":"clean"}`,
			wantStatus:  http.StatusBadRequest,
			wantContain: "Email is required",
		},
		{
			name:        "invalid email format",
			rawBody:     `{"email":"admin","password":"StrongPass123!","mode":"clean"}`,
			wantStatus:  http.StatusBadRequest,
			wantContain: "Invalid email format",
		},
		{
			name:        "short password",
			rawBody:     `{"email":"admin@example.com","password":"short","mode":"clean"}`,
			wantStatus:  http.StatusBadRequest,
			wantContain: "Password must be at least 12 characters",
		},
		{
			name:        "invalid mode",
			rawBody:     `{"email":"admin@example.com","password":"StrongPass123!","mode":"unknown"}`,
			wantStatus:  http.StatusBadRequest,
			wantContain: "Invalid mode. Allowed: clean, secure, migrate",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/system/setup", bytes.NewBufferString(tc.rawBody))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)

			err := h.SetupSystem(c)
			require.NoError(t, err)
			assert.Equal(t, tc.wantStatus, rec.Code)
			assert.Contains(t, rec.Body.String(), tc.wantContain)
		})
	}
}

func TestSetupSystem_ConcurrentInitialization(t *testing.T) {
	db := setupSystemTestDB(t)
	h := &Handler{
		DB:   db,
		Auth: core.NewAuthService(db, "test-jwt-secret", nil),
	}

	const attempts = 8
	type response struct {
		code int
		body string
		err  error
	}

	e := echo.New()
	results := make(chan response, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			payload := map[string]string{
				"email":    fmt.Sprintf("admin_%d@example.com", i),
				"password": "StrongPass123!",
				"mode":     "clean",
			}
			raw, marshalErr := json.Marshal(payload)
			if marshalErr != nil {
				results <- response{err: marshalErr}
				return
			}

			req := httptest.NewRequest(http.MethodPost, "/api/system/setup", bytes.NewReader(raw))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)

			callErr := h.SetupSystem(c)
			results <- response{
				code: rec.Code,
				body: rec.Body.String(),
				err:  callErr,
			}
		}(i)
	}

	wg.Wait()
	close(results)

	okCount := 0
	forbiddenCount := 0
	unexpected := make([]response, 0)

	for result := range results {
		require.NoError(t, result.err)
		switch result.code {
		case http.StatusOK:
			okCount++
		case http.StatusForbidden:
			forbiddenCount++
		default:
			unexpected = append(unexpected, result)
		}
	}

	assert.Equal(t, 1, okCount, "exactly one setup request must initialize the system")
	assert.Equal(t, attempts-1, forbiddenCount, "all remaining requests must be rejected as already initialized")
	if len(unexpected) > 0 {
		t.Fatalf("unexpected statuses: %+v", unexpected)
	}

	var adminCount int
	err := db.Pool.QueryRow(context.Background(), "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&adminCount)
	require.NoError(t, err)
	assert.Equal(t, 1, adminCount, "database must contain exactly one admin")
}

func TestSetupSystem_SecureModeReportsAppliedPreset(t *testing.T) {
	db := setupSystemTestDB(t)
	h := &Handler{
		DB:   db,
		Auth: core.NewAuthService(db, "test-jwt-secret", nil),
	}

	resp, rec := performSetupRequest(t, h, map[string]string{
		"email":         "secure-admin@example.com",
		"password":      "StrongPass123!",
		"mode":          "secure",
		"allow_country": "Peru",
	})

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "secure", resp.Mode)
	assert.NotEmpty(t, resp.Token)
	assert.Contains(t, resp.Summary, "Peru")
	assert.True(t, hasSetupAction(resp.AppliedActions, "geo_fencing"))
	assert.True(t, hasSetupAction(resp.AppliedActions, "secure_audit_log"))

	var rawConfig []byte
	err := db.Pool.QueryRow(context.Background(), "SELECT config FROM _v_security_policies WHERE type = 'geo_fencing'").Scan(&rawConfig)
	require.NoError(t, err)
	assert.Contains(t, string(rawConfig), "Peru")

	var auditCount int
	err = db.Pool.QueryRow(context.Background(), "SELECT COUNT(*) FROM _v_audit_logs WHERE path = 'SETUP_SECURE'").Scan(&auditCount)
	require.NoError(t, err)
	assert.Equal(t, 1, auditCount)
}

func TestSetupSystem_MigrateModePreservesExistingUserTablesAndReportsSummary(t *testing.T) {
	db := setupSystemTestDB(t)
	h := &Handler{
		DB:   db,
		Auth: core.NewAuthService(db, "test-jwt-secret", nil),
	}

	ctx := context.Background()
	tableName := fmt.Sprintf("migrate_fixture_%d", time.Now().UnixNano())

	_, err := db.Pool.Exec(ctx, fmt.Sprintf(`
		CREATE TABLE %s (
			id BIGSERIAL PRIMARY KEY,
			name TEXT NOT NULL
		)
	`, tableName))
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s", tableName))
	})

	_, err = db.Pool.Exec(ctx, fmt.Sprintf("INSERT INTO %s (name) VALUES ('kept row')", tableName))
	require.NoError(t, err)

	expectedTableCount := countUserTablesForSetupTest(t, db)

	resp, rec := performSetupRequest(t, h, map[string]string{
		"email":    "migrate-admin@example.com",
		"password": "StrongPass123!",
		"mode":     "migrate",
	})

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "migrate", resp.Mode)
	assert.Equal(t, expectedTableCount, resp.PreservedTableCount)
	assert.True(t, hasSetupAction(resp.AppliedActions, "preserve_existing_tables"))
	assert.True(t, hasSetupAction(resp.AppliedActions, "migration_audit_log"))

	var rowCount int
	err = db.Pool.QueryRow(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s", tableName)).Scan(&rowCount)
	require.NoError(t, err)
	assert.Equal(t, 1, rowCount)

	var auditCount int
	err = db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_audit_logs WHERE path = 'SETUP_MIGRATE'").Scan(&auditCount)
	require.NoError(t, err)
	assert.Equal(t, 1, auditCount)
}

type setupResponseBody struct {
	Status              string        `json:"status"`
	Token               string        `json:"token"`
	Mode                string        `json:"mode"`
	Summary             string        `json:"summary"`
	AppliedActions      []setupAction `json:"applied_actions"`
	PreservedTableCount int           `json:"preserved_table_count"`
}

func performSetupRequest(t *testing.T, h *Handler, payload map[string]string) (setupResponseBody, *httptest.ResponseRecorder) {
	t.Helper()

	raw, err := json.Marshal(payload)
	require.NoError(t, err)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/system/setup", bytes.NewReader(raw))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = h.SetupSystem(c)
	require.NoError(t, err)

	var body setupResponseBody
	if rec.Body.Len() > 0 {
		err = json.Unmarshal(rec.Body.Bytes(), &body)
		require.NoError(t, err)
	}

	return body, rec
}

func hasSetupAction(actions []setupAction, key string) bool {
	for _, action := range actions {
		if action.Key == key {
			return true
		}
	}
	return false
}

func countUserTablesForSetupTest(t *testing.T, db *data.DB) int {
	t.Helper()

	var count int
	err := db.Pool.QueryRow(context.Background(), `
		SELECT COUNT(*)
		FROM information_schema.tables
		WHERE table_schema = 'public'
		  AND table_type = 'BASE TABLE'
		  AND table_name NOT LIKE '\_v\_%' ESCAPE '\'
	`).Scan(&count)
	require.NoError(t, err)
	return count
}

func setupSystemTestDB(t *testing.T) *data.DB {
	t.Helper()

	databaseURL := strings.TrimSpace(os.Getenv("OZY_TEST_DATABASE_URL"))
	if databaseURL == "" {
		databaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	}
	if databaseURL == "" {
		t.Skip("set OZY_TEST_DATABASE_URL or DATABASE_URL to run SetupSystem integration/concurrency test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db, err := data.Connect(ctx, databaseURL)
	require.NoError(t, err)
	t.Cleanup(db.Close)

	require.NoError(t, db.RunMigrations(ctx))

	_, err = db.Pool.Exec(ctx, `
		TRUNCATE TABLE
			_v_sessions,
			_v_users,
			_v_audit_logs,
			_v_security_policies
		RESTART IDENTITY CASCADE
	`)
	require.NoError(t, err)

	return db
}
