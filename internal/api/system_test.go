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
		{
			name:        "migrate mode requires payload",
			rawBody:     `{"email":"admin@example.com","password":"StrongPass123!","mode":"migrate"}`,
			wantStatus:  http.StatusBadRequest,
			wantContain: "Migration payload is required",
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

	resp, rec := performSetupRequest(t, h, map[string]any{
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
	assert.Contains(t, string(rawConfig), "blocked_countries")
	assert.NotContains(t, string(rawConfig), `"Peru"`)

	var auditCount int
	err = db.Pool.QueryRow(context.Background(), "SELECT COUNT(*) FROM _v_audit_logs WHERE path = 'SETUP_SECURE'").Scan(&auditCount)
	require.NoError(t, err)
	assert.Equal(t, 1, auditCount)
}

func TestSetupSystem_FirstAdminStartsVerified(t *testing.T) {
	db := setupSystemTestDB(t)
	h := &Handler{
		DB:   db,
		Auth: core.NewAuthService(db, "test-jwt-secret", nil),
	}

	_, rec := performSetupRequest(t, h, map[string]any{
		"email":    "verified-admin@example.com",
		"password": "StrongPass123!",
		"mode":     "clean",
	})

	require.Equal(t, http.StatusOK, rec.Code)

	var isVerified bool
	err := db.Pool.QueryRow(context.Background(), "SELECT is_verified FROM _v_users WHERE email = $1", "verified-admin@example.com").Scan(&isVerified)
	require.NoError(t, err)
	assert.True(t, isVerified)
}

func TestPreviewSetupMigration_CSVReturnsTranslatedPlan(t *testing.T) {
	e := echo.New()
	h := &Handler{}

	req := httptest.NewRequest(http.MethodPost, "/api/system/setup/migration/preview", bytes.NewBufferString(`{
		"source_kind":"csv",
		"table_name":"legacy_users",
		"raw_input":"id,name,email\n1,Ana,ana@example.com\n2,Luis,luis@example.com",
		"import_rows":true
	}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.PreviewSetupMigration(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code)

	var payload struct {
		TableCount int `json:"table_count"`
		RowCount   int `json:"row_count"`
		Tables     []struct {
			Name          string           `json:"name"`
			DetectedRows  int              `json:"detected_rows"`
			TranslatedSQL string           `json:"translated_sql"`
			SampleRows    []map[string]any `json:"sample_rows"`
		} `json:"tables"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, 1, payload.TableCount)
	require.Equal(t, 2, payload.RowCount)
	require.Len(t, payload.Tables, 1)
	assert.Equal(t, "legacy_users", payload.Tables[0].Name)
	assert.Equal(t, 2, payload.Tables[0].DetectedRows)
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s", data.QuoteIdentifier("legacy_users")))
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("%s TEXT", data.QuoteIdentifier("email")))
	require.Len(t, payload.Tables[0].SampleRows, 2)
	assert.Equal(t, "Ana", payload.Tables[0].SampleRows[0]["name"])
}

func TestPreviewSetupMigration_MongoJSONReturnsTranslatedPlan(t *testing.T) {
	e := echo.New()
	h := &Handler{}

	req := httptest.NewRequest(http.MethodPost, "/api/system/setup/migration/preview", bytes.NewBufferString(`{
		"source_kind":"mongo_json",
		"table_name":"mongo_people",
		"raw_input":"[{\"name\":\"Ana\",\"active\":true,\"age\":31},{\"name\":\"Luis\",\"active\":false,\"age\":28}]",
		"import_rows":true
	}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.PreviewSetupMigration(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code)

	var payload struct {
		TableCount int `json:"table_count"`
		RowCount   int `json:"row_count"`
		Tables     []struct {
			Name          string `json:"name"`
			DetectedRows  int    `json:"detected_rows"`
			TranslatedSQL string `json:"translated_sql"`
			Columns       []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"columns"`
		} `json:"tables"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, 1, payload.TableCount)
	require.Equal(t, 2, payload.RowCount)
	require.Len(t, payload.Tables, 1)
	assert.Equal(t, "mongo_people", payload.Tables[0].Name)
	assert.Equal(t, 2, payload.Tables[0].DetectedRows)
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s", data.QuoteIdentifier("mongo_people")))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "name"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "active"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "age"))
}

func TestPreviewSetupMigration_MySQLDumpSupportsPositionalInsertPreview(t *testing.T) {
	e := echo.New()
	h := &Handler{}

	mysqlDump := strings.TrimSpace(`
DROP TABLE IF EXISTS ` + "`location`" + `;
CREATE TABLE ` + "`location`" + ` (
  ` + "`location_id`" + ` int(11) NOT NULL,
  ` + "`name`" + ` varchar(255) DEFAULT NULL,
  ` + "`active`" + ` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (` + "`location_id`" + `),
  KEY ` + "`idx_location_name`" + ` (` + "`name`" + `)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE ` + "`location`" + `
  MODIFY ` + "`location_id`" + ` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1875;
INSERT INTO ` + "`location`" + ` VALUES
  (1,'Lima',1),
  (2,'Cusco',0);
`)

	req := httptest.NewRequest(http.MethodPost, "/api/system/setup/migration/preview", bytes.NewBufferString(fmt.Sprintf(`{
		"source_kind":"mysql_sql",
		"raw_input":%q,
		"import_rows":true
	}`, mysqlDump)))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.PreviewSetupMigration(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var payload struct {
		TableCount int      `json:"table_count"`
		RowCount   int      `json:"row_count"`
		Warnings   []string `json:"warnings"`
		Tables     []struct {
			Name         string `json:"name"`
			ColumnCount  int    `json:"column_count"`
			DetectedRows int    `json:"detected_rows"`
			Columns      []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"columns"`
			TranslatedSQL string           `json:"translated_sql"`
			SampleRows    []map[string]any `json:"sample_rows"`
			Warnings      []string         `json:"warnings"`
		} `json:"tables"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, 1, payload.TableCount)
	require.Equal(t, 2, payload.RowCount)
	require.Len(t, payload.Tables, 1)
	assert.Equal(t, "location", payload.Tables[0].Name)
	assert.Equal(t, 3, payload.Tables[0].ColumnCount)
	assert.Equal(t, 2, payload.Tables[0].DetectedRows)
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s", data.QuoteIdentifier("location")))
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("%s INT4", data.QuoteIdentifier("location_id")))
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("%s BOOLEAN", data.QuoteIdentifier("active")))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "location_id"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "name"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "active"))
	assert.False(t, hasPreviewColumn(payload.Tables[0].Columns, "key"))
	require.Len(t, payload.Tables[0].SampleRows, 2)
	assert.EqualValues(t, 1, payload.Tables[0].SampleRows[0]["active"])
	assert.True(t, containsSubstring(payload.Warnings, "Ignored unsupported setup statement: ALTER TABLE"))
	assert.True(t, containsSubstring(payload.Tables[0].Warnings, "Mapped positional INSERT values"))
}

func TestPreviewSetupMigration_MySQLDumpKeepsRowsWhenInsertAppearsBeforeCreate(t *testing.T) {
	e := echo.New()
	h := &Handler{}

	mysqlDump := strings.TrimSpace(`
INSERT INTO ` + "`menu`" + ` VALUES
  (10,'Dashboard'),
  (11,'Users');
CREATE TABLE ` + "`menu`" + ` (
  ` + "`id`" + ` int(11) NOT NULL,
  ` + "`label`" + ` varchar(120) NOT NULL,
  PRIMARY KEY (` + "`id`" + `)
);
`)

	req := httptest.NewRequest(http.MethodPost, "/api/system/setup/migration/preview", bytes.NewBufferString(fmt.Sprintf(`{
		"source_kind":"mysql_sql",
		"raw_input":%q,
		"import_rows":true
	}`, mysqlDump)))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.PreviewSetupMigration(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var payload struct {
		TableCount int `json:"table_count"`
		RowCount   int `json:"row_count"`
		Tables     []struct {
			Name         string `json:"name"`
			ColumnCount  int    `json:"column_count"`
			DetectedRows int    `json:"detected_rows"`
			Columns      []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"columns"`
		} `json:"tables"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, 1, payload.TableCount)
	require.Equal(t, 2, payload.RowCount)
	require.Len(t, payload.Tables, 1)
	assert.Equal(t, "menu", payload.Tables[0].Name)
	assert.Equal(t, 2, payload.Tables[0].ColumnCount)
	assert.Equal(t, 2, payload.Tables[0].DetectedRows)
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "id"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "label"))
}

func TestPreviewSetupMigration_MySQLDumpQuotesReservedIdentifiers(t *testing.T) {
	e := echo.New()
	h := &Handler{}

	mysqlDump := strings.TrimSpace(`
CREATE TABLE ` + "`menu`" + ` (
  ` + "`id`" + ` int(11) NOT NULL,
  ` + "`group`" + ` varchar(80) NOT NULL,
  ` + "`label`" + ` varchar(120) NOT NULL,
  PRIMARY KEY (` + "`id`" + `)
);
INSERT INTO ` + "`menu`" + ` VALUES
  (10,'admin','Dashboard'),
  (11,'staff','Users');
`)

	req := httptest.NewRequest(http.MethodPost, "/api/system/setup/migration/preview", bytes.NewBufferString(fmt.Sprintf(`{
		"source_kind":"mysql_sql",
		"raw_input":%q,
		"import_rows":true
	}`, mysqlDump)))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.PreviewSetupMigration(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var payload struct {
		TableCount int `json:"table_count"`
		RowCount   int `json:"row_count"`
		Tables     []struct {
			Name          string `json:"name"`
			ColumnCount   int    `json:"column_count"`
			DetectedRows  int    `json:"detected_rows"`
			TranslatedSQL string `json:"translated_sql"`
			Columns       []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"columns"`
		} `json:"tables"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, 1, payload.TableCount)
	require.Equal(t, 2, payload.RowCount)
	require.Len(t, payload.Tables, 1)
	assert.Equal(t, "menu", payload.Tables[0].Name)
	assert.Equal(t, 3, payload.Tables[0].ColumnCount)
	assert.Equal(t, 2, payload.Tables[0].DetectedRows)
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s", data.QuoteIdentifier("menu")))
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("%s TEXT", data.QuoteIdentifier("group")))
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("%s TEXT", data.QuoteIdentifier("label")))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "id"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "group"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "label"))
}

func TestPreviewSetupMigration_SQLiteDumpReturnsTranslatedPlan(t *testing.T) {
	e := echo.New()
	h := &Handler{}

	sqliteDump := strings.TrimSpace(`
CREATE TABLE "task" (
  "id" INTEGER PRIMARY KEY,
  "label" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT 1
);
INSERT INTO "task" VALUES
  (1,'Backlog',1),
  (2,'Done',0);
`)

	req := httptest.NewRequest(http.MethodPost, "/api/system/setup/migration/preview", bytes.NewBufferString(fmt.Sprintf(`{
		"source_kind":"sqlite_sql",
		"raw_input":%q,
		"import_rows":true
	}`, sqliteDump)))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.PreviewSetupMigration(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var payload struct {
		TableCount int `json:"table_count"`
		RowCount   int `json:"row_count"`
		Tables     []struct {
			Name          string `json:"name"`
			ColumnCount   int    `json:"column_count"`
			DetectedRows  int    `json:"detected_rows"`
			TranslatedSQL string `json:"translated_sql"`
			Columns       []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"columns"`
		} `json:"tables"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, 1, payload.TableCount)
	require.Equal(t, 2, payload.RowCount)
	require.Len(t, payload.Tables, 1)
	assert.Equal(t, "task", payload.Tables[0].Name)
	assert.Equal(t, 3, payload.Tables[0].ColumnCount)
	assert.Equal(t, 2, payload.Tables[0].DetectedRows)
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s", data.QuoteIdentifier("task")))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "id"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "label"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "active"))
}

func TestPreviewSetupMigration_SQLServerDumpReturnsTranslatedPlan(t *testing.T) {
	e := echo.New()
	h := &Handler{}

	sqlServerDump := strings.TrimSpace(`
CREATE TABLE [team] (
  [id] INT NOT NULL PRIMARY KEY,
  [name] NVARCHAR(120) NOT NULL,
  [active] BIT NOT NULL DEFAULT 1
);
INSERT INTO [team] VALUES
  (1,N'Ana',1),
  (2,N'Luis',0);
`)

	req := httptest.NewRequest(http.MethodPost, "/api/system/setup/migration/preview", bytes.NewBufferString(fmt.Sprintf(`{
		"source_kind":"sqlserver_sql",
		"raw_input":%q,
		"import_rows":true
	}`, sqlServerDump)))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.PreviewSetupMigration(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var payload struct {
		TableCount int `json:"table_count"`
		RowCount   int `json:"row_count"`
		Tables     []struct {
			Name          string `json:"name"`
			ColumnCount   int    `json:"column_count"`
			DetectedRows  int    `json:"detected_rows"`
			TranslatedSQL string `json:"translated_sql"`
			Columns       []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"columns"`
		} `json:"tables"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, 1, payload.TableCount)
	require.Equal(t, 2, payload.RowCount)
	require.Len(t, payload.Tables, 1)
	assert.Equal(t, "team", payload.Tables[0].Name)
	assert.Equal(t, 3, payload.Tables[0].ColumnCount)
	assert.Equal(t, 2, payload.Tables[0].DetectedRows)
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s", data.QuoteIdentifier("team")))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "id"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "name"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "active"))
}

func TestPreviewSetupMigration_PostgresDumpReturnsTranslatedPlan(t *testing.T) {
	e := echo.New()
	h := &Handler{}

	postgresDump := strings.TrimSpace(`
CREATE TABLE public.account (
  id BIGINT PRIMARY KEY,
  email TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO public.account VALUES
  (1,'ana@example.com',TRUE),
  (2,'luis@example.com',FALSE);
`)

	req := httptest.NewRequest(http.MethodPost, "/api/system/setup/migration/preview", bytes.NewBufferString(fmt.Sprintf(`{
		"source_kind":"postgres_sql",
		"raw_input":%q,
		"import_rows":true
	}`, postgresDump)))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.PreviewSetupMigration(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var payload struct {
		TableCount int `json:"table_count"`
		RowCount   int `json:"row_count"`
		Tables     []struct {
			Name          string `json:"name"`
			ColumnCount   int    `json:"column_count"`
			DetectedRows  int    `json:"detected_rows"`
			TranslatedSQL string `json:"translated_sql"`
			Columns       []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"columns"`
		} `json:"tables"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, 1, payload.TableCount)
	require.Equal(t, 2, payload.RowCount)
	require.Len(t, payload.Tables, 1)
	assert.Equal(t, "account", payload.Tables[0].Name)
	assert.Equal(t, 3, payload.Tables[0].ColumnCount)
	assert.Equal(t, 2, payload.Tables[0].DetectedRows)
	assert.Contains(t, payload.Tables[0].TranslatedSQL, fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s", data.QuoteIdentifier("account")))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "id"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "email"))
	assert.True(t, hasPreviewColumn(payload.Tables[0].Columns, "active"))
}

func TestSetupSystem_MigrateModeAppliesCSVMigrationPlan(t *testing.T) {
	db := setupSystemTestDB(t)
	h := &Handler{
		DB:   db,
		Auth: core.NewAuthService(db, "test-jwt-secret", nil),
	}

	ctx := context.Background()
	tableName := fmt.Sprintf("migrate_fixture_%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s", tableName))
	})

	resp, rec := performSetupRequest(t, h, map[string]any{
		"email":    "migrate-admin@example.com",
		"password": "StrongPass123!",
		"mode":     "migrate",
		"migration": map[string]any{
			"source_kind": "csv",
			"table_name":  tableName,
			"raw_input":   "id,name,active\n1,Ana,true\n2,Luis,false",
			"import_rows": true,
		},
	})

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "migrate", resp.Mode)
	assert.Equal(t, 1, resp.MigratedTableCount)
	assert.Equal(t, 2, resp.ImportedRowCount)
	assert.True(t, hasSetupAction(resp.AppliedActions, "migration_plan_applied"))
	assert.True(t, hasSetupAction(resp.AppliedActions, "migration_rows_imported"))
	assert.True(t, hasSetupAction(resp.AppliedActions, "migration_audit_log"))

	var rowCount int
	err := db.Pool.QueryRow(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s", tableName)).Scan(&rowCount)
	require.NoError(t, err)
	assert.Equal(t, 2, rowCount)

	var activeCount int
	err = db.Pool.QueryRow(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE active = TRUE", tableName)).Scan(&activeCount)
	require.NoError(t, err)
	assert.Equal(t, 1, activeCount)

	var metadataCount int
	err = db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_collections WHERE name = $1", tableName).Scan(&metadataCount)
	require.NoError(t, err)
	assert.Equal(t, 1, metadataCount)

	var auditCount int
	err = db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_audit_logs WHERE path = 'SETUP_MIGRATE'").Scan(&auditCount)
	require.NoError(t, err)
	assert.Equal(t, 1, auditCount)
}

func TestSetupSystem_MigrateModeAppliesSQLDumpWithReservedColumnNames(t *testing.T) {
	db := setupSystemTestDB(t)
	h := &Handler{
		DB:   db,
		Auth: core.NewAuthService(db, "test-jwt-secret", nil),
	}

	ctx := context.Background()
	tableName := fmt.Sprintf("menu_%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s", data.QuoteIdentifier(tableName)))
	})

	mysqlDump := strings.TrimSpace(fmt.Sprintf(`
CREATE TABLE %s (
  %s int(11) NOT NULL,
  %s varchar(80) NOT NULL,
  %s varchar(120) NOT NULL,
  PRIMARY KEY (%s)
);
INSERT INTO %s VALUES
  (10,'admin','Dashboard'),
  (11,'staff','Users');
`,
		"`"+tableName+"`",
		"`id`",
		"`group`",
		"`label`",
		"`id`",
		"`"+tableName+"`",
	))

	resp, rec := performSetupRequest(t, h, map[string]any{
		"email":    "migrate-reserved@example.com",
		"password": "StrongPass123!",
		"mode":     "migrate",
		"migration": map[string]any{
			"source_kind": "mysql_sql",
			"raw_input":   mysqlDump,
			"import_rows": true,
		},
	})

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "migrate", resp.Mode)
	assert.Equal(t, 1, resp.MigratedTableCount)
	assert.Equal(t, 2, resp.ImportedRowCount)

	var rowCount int
	err := db.Pool.QueryRow(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s", data.QuoteIdentifier(tableName))).Scan(&rowCount)
	require.NoError(t, err)
	assert.Equal(t, 2, rowCount)

	var adminCount int
	err = db.Pool.QueryRow(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s = 'admin'", data.QuoteIdentifier(tableName), data.QuoteIdentifier("group"))).Scan(&adminCount)
	require.NoError(t, err)
	assert.Equal(t, 1, adminCount)
}

func hasPreviewColumn(columns []struct {
	Name string `json:"name"`
	Type string `json:"type"`
}, target string) bool {
	for _, column := range columns {
		if column.Name == target {
			return true
		}
	}
	return false
}

func containsSubstring(values []string, target string) bool {
	for _, value := range values {
		if strings.Contains(value, target) {
			return true
		}
	}
	return false
}

type setupResponseBody struct {
	Status              string        `json:"status"`
	Token               string        `json:"token"`
	Mode                string        `json:"mode"`
	Summary             string        `json:"summary"`
	AppliedActions      []setupAction `json:"applied_actions"`
	PreservedTableCount int           `json:"preserved_table_count"`
	MigratedTableCount  int           `json:"migrated_table_count"`
	ImportedRowCount    int           `json:"imported_row_count"`
	MigrationWarnings   []string      `json:"migration_warnings"`
}

func performSetupRequest(t *testing.T, h *Handler, payload map[string]any) (setupResponseBody, *httptest.ResponseRecorder) {
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
			_v_security_policies,
			_v_workspace_members,
			_v_workspaces
		RESTART IDENTITY CASCADE
	`)
	require.NoError(t, err)

	return db
}
