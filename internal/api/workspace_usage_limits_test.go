package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProjectInfo_ReportsSelfHostedCapabilities(t *testing.T) {
	db := setupWorkspaceUsageLimitsTestDB(t)
	handler := &Handler{
		DB: db,
		Metrics: &Metrics{
			DbHistory:       make([]int, 60),
			AuthHistory:     make([]int, 60),
			StorageHistory:  make([]int, 60),
			RealtimeHistory: make([]int, 60),
			CpuHistory:      make([]float64, 60),
			RamHistory:      make([]float64, 60),
		},
		Production: ProjectProductionReadiness{Profile: "single_project_local"},
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/project/info", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := handler.GetProjectInfo(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var payload ProjectInfo
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	assert.Equal(t, "logical_shared_db", payload.ProjectScopeMode)
	assert.False(t, payload.Capabilities.SupportsDedicatedSchema)
	assert.False(t, payload.Capabilities.SupportsDedicatedDatabase)
	assert.False(t, payload.Capabilities.SupportsManagedBilling)
	assert.False(t, payload.Capabilities.SupportsManagedPITR)
	assert.False(t, payload.Capabilities.SupportsReadReplicasUI)
	assert.False(t, payload.Capabilities.SupportsFailoverUI)
}

func TestWorkspaceUsageAndLimitsEndpoints(t *testing.T) {
	db := setupWorkspaceUsageLimitsTestDB(t)
	userID, workspaceID := seedWorkspaceUsageLimitsContext(t, db, "usage-limits@example.com")
	tableName := fmt.Sprintf("usage_limits_%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s", data.QuoteIdentifier(tableName)))
	})

	_, err := db.Pool.Exec(context.Background(), fmt.Sprintf(`
		CREATE TABLE %s (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			title TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)
	`, data.QuoteIdentifier(tableName)))
	require.NoError(t, err)

	_, err = db.Pool.Exec(context.Background(), `
		INSERT INTO _v_collections (name, display_name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, workspace_id)
		VALUES ($1, $2, '[]'::jsonb, 'auth', 'admin', FALSE, '', FALSE, $3)
	`, tableName, "Usage Limits", workspaceID)
	require.NoError(t, err)

	_, err = db.Pool.Exec(context.Background(), fmt.Sprintf(`
		INSERT INTO %s (title) VALUES ('A'), ('B')
	`, data.QuoteIdentifier(tableName)))
	require.NoError(t, err)

	var bucketID string
	err = db.Pool.QueryRow(context.Background(), `
		INSERT INTO _v_buckets (name, public, rls_enabled, rls_rule)
		VALUES ('default', FALSE, FALSE, 'true')
		RETURNING id
	`).Scan(&bucketID)
	require.NoError(t, err)

	_, err = db.Pool.Exec(context.Background(), `
		INSERT INTO _v_storage_objects (bucket_id, owner_id, workspace_id, name, size, content_type, path)
		VALUES ($1, $2::uuid, $3::uuid, 'demo.txt', 2048, 'text/plain', 'demo.txt')
	`, bucketID, userID, workspaceID)
	require.NoError(t, err)

	_, err = db.Pool.Exec(context.Background(), `
		INSERT INTO _v_audit_logs (user_id, workspace_id, ip_address, method, path, status, latency_ms, country, city, user_agent, created_at)
		VALUES
			($1::uuid, $2::uuid, '127.0.0.1', 'GET', '/api/project/info', 200, 12, 'PE', 'Lima', 'test', NOW()),
			($1::uuid, $2::uuid, '127.0.0.1', 'GET', '/api/realtime', 200, 15, 'PE', 'Lima', 'test', NOW()),
			($1::uuid, $2::uuid, '127.0.0.1', 'POST', '/api/functions/demo/invoke', 200, 18, 'PE', 'Lima', 'test', NOW())
	`, userID, workspaceID)
	require.NoError(t, err)

	handler := NewWorkspaceHandler(core.NewWorkspaceService(db), nil)

	limitsReq := map[string]any{
		"warning_threshold_pct":           60,
		"rows_hard_limit":                 2,
		"storage_bytes_hard_limit":        2048,
		"api_requests_soft_limit":         2,
		"realtime_events_soft_limit":      1,
		"function_invocations_soft_limit": 1,
	}
	rec := performWorkspaceLimitsPatchRequest(t, handler, workspaceID, userID, "owner", limitsReq)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	getLimitsRec := performWorkspaceLimitsGetRequest(t, handler, workspaceID, userID, "owner")
	require.Equal(t, http.StatusOK, getLimitsRec.Code, getLimitsRec.Body.String())
	var limits core.WorkspaceLimits
	require.NoError(t, json.Unmarshal(getLimitsRec.Body.Bytes(), &limits))
	assert.EqualValues(t, 2, limits.RowsHardLimit)
	assert.EqualValues(t, 2048, limits.StorageBytesHardLimit)

	getUsageRec := performWorkspaceUsageGetRequest(t, handler, workspaceID, userID, "owner")
	require.Equal(t, http.StatusOK, getUsageRec.Code, getUsageRec.Body.String())
	var usage core.WorkspaceUsage
	require.NoError(t, json.Unmarshal(getUsageRec.Body.Bytes(), &usage))
	assert.EqualValues(t, 2, usage.Rows)
	assert.EqualValues(t, 2048, usage.StorageBytes)
	assert.EqualValues(t, 3, usage.APIRequests)
	assert.EqualValues(t, 1, usage.RealtimeEvents)
	assert.EqualValues(t, 1, usage.FunctionInvocations)
	assert.NotEmpty(t, usage.Warnings)
}

func TestCreateRecord_EnforcesWorkspaceRowHardLimit(t *testing.T) {
	db := setupWorkspaceUsageLimitsTestDB(t)
	userID, workspaceID := seedWorkspaceUsageLimitsContext(t, db, "row-limit@example.com")
	tableName := fmt.Sprintf("row_limit_%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s", data.QuoteIdentifier(tableName)))
	})

	_, err := db.Pool.Exec(context.Background(), fmt.Sprintf(`
		CREATE TABLE %s (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			title TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)
	`, data.QuoteIdentifier(tableName)))
	require.NoError(t, err)

	_, err = db.Pool.Exec(context.Background(), `
		INSERT INTO _v_collections (name, display_name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, workspace_id)
		VALUES ($1, $2, '[]'::jsonb, 'auth', 'admin', FALSE, '', FALSE, $3)
	`, tableName, "Rows Limit", workspaceID)
	require.NoError(t, err)

	_, err = db.Pool.Exec(context.Background(), fmt.Sprintf(`
		INSERT INTO %s (title) VALUES ('Existing row')
	`, data.QuoteIdentifier(tableName)))
	require.NoError(t, err)

	require.NoError(t, core.NewWorkspaceService(db).UpdateWorkspaceLimits(context.Background(), workspaceID, core.WorkspaceLimits{
		WarningThresholdPct:      80,
		RowsHardLimit:            1,
		StorageBytesHardLimit:    0,
		APIRequestsSoftLimit:     0,
		RealtimeEventsSoftLimit:  0,
		FunctionInvocationsLimit: 0,
	}))

	handler := &Handler{DB: db}
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/collections/"+tableName+"/records", bytes.NewBufferString(`{"title":"Blocked row"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetPath("/api/collections/:name/records")
	c.SetParamNames("name")
	c.SetParamValues(tableName)
	c.Set("workspace_id", workspaceID)
	c.Set("user_id", userID)
	c.Set("role", "admin")

	err = handler.CreateRecord(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "project row limit exceeded")
}

func TestCreateUploadSession_EnforcesWorkspaceStorageHardLimit(t *testing.T) {
	db := setupWorkspaceUsageLimitsTestDB(t)
	userID, workspaceID := seedWorkspaceUsageLimitsContext(t, db, "storage-limit@example.com")

	require.NoError(t, core.NewWorkspaceService(db).UpdateWorkspaceLimits(context.Background(), workspaceID, core.WorkspaceLimits{
		WarningThresholdPct:      80,
		RowsHardLimit:            0,
		StorageBytesHardLimit:    1024,
		APIRequestsSoftLimit:     0,
		RealtimeEventsSoftLimit:  0,
		FunctionInvocationsLimit: 0,
	}))

	var bucketID string
	err := db.Pool.QueryRow(context.Background(), `
		INSERT INTO _v_buckets (name, public, rls_enabled, rls_rule)
		VALUES ('default', FALSE, FALSE, 'true')
		RETURNING id
	`).Scan(&bucketID)
	require.NoError(t, err)

	_, err = db.Pool.Exec(context.Background(), `
		INSERT INTO _v_storage_objects (bucket_id, owner_id, workspace_id, name, size, content_type, path)
		VALUES ($1, $2::uuid, $3::uuid, 'existing.txt', 900, 'text/plain', 'existing.txt')
	`, bucketID, userID, workspaceID)
	require.NoError(t, err)

	fileHandler := NewFileHandler(db, nil, "", "upload-secret")
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/files/uploads/session", bytes.NewBufferString(`{
		"bucket":"default",
		"filename":"new.txt",
		"content_type":"text/plain",
		"size":200
	}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user_id", userID)
	c.Set("role", "admin")
	c.Set("workspace_id", workspaceID)

	err = fileHandler.CreateUploadSession(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusRequestEntityTooLarge, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "project storage limit exceeded")
}

func setupWorkspaceUsageLimitsTestDB(t *testing.T) *data.DB {
	t.Helper()

	db := setupSystemTestDB(t)
	_, err := db.Pool.Exec(context.Background(), `
		TRUNCATE TABLE
			_v_storage_upload_session_parts,
			_v_storage_upload_sessions,
			_v_storage_objects,
			_v_buckets,
			_v_api_key_events,
			_v_api_keys,
			_v_table_views,
			_v_workspace_members,
			_v_workspaces,
			_v_collections,
			_v_audit_logs
		RESTART IDENTITY CASCADE
	`)
	require.NoError(t, err)
	return db
}

func seedWorkspaceUsageLimitsContext(t *testing.T, db *data.DB, email string) (string, string) {
	t.Helper()

	userID := insertLegacyAdminUser(t, db, email)
	workspace, err := core.NewWorkspaceService(db).CreateWorkspace(context.Background(), "Primary Project", userID)
	require.NoError(t, err)
	require.NotNil(t, workspace)
	return userID, workspace.ID
}

func performWorkspaceLimitsPatchRequest(t *testing.T, handler *WorkspaceHandler, workspaceID, userID, role string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()

	raw, err := json.Marshal(payload)
	require.NoError(t, err)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPatch, "/api/workspaces/"+workspaceID+"/limits", bytes.NewReader(raw))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(workspaceID)
	c.Set("user_id", userID)
	c.Set("role", role)

	err = handler.UpdateLimits(c)
	require.NoError(t, err)
	return rec
}

func performWorkspaceLimitsGetRequest(t *testing.T, handler *WorkspaceHandler, workspaceID, userID, role string) *httptest.ResponseRecorder {
	t.Helper()

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces/"+workspaceID+"/limits", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(workspaceID)
	c.Set("user_id", userID)
	c.Set("role", role)

	err := handler.GetLimits(c)
	require.NoError(t, err)
	return rec
}

func performWorkspaceUsageGetRequest(t *testing.T, handler *WorkspaceHandler, workspaceID, userID, role string) *httptest.ResponseRecorder {
	t.Helper()

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces/"+workspaceID+"/usage", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(workspaceID)
	c.Set("user_id", userID)
	c.Set("role", role)

	err := handler.GetUsage(c)
	require.NoError(t, err)
	return rec
}
