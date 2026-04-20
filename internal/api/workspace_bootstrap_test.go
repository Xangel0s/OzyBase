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

type workspaceBootstrapResponse struct {
	WorkspaceID      string `json:"workspace_id"`
	WorkspaceName    string `json:"workspace_name"`
	BootstrapApplied bool   `json:"bootstrap_applied"`
	Resolution       string `json:"resolution"`
	Error            string `json:"error"`
	ErrorCode        string `json:"error_code"`
}

func TestSetupSystem_CreatesWorkspaceAndScopesMigratedCollections(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	h := &Handler{
		DB:   db,
		Auth: core.NewAuthService(db, "test-jwt-secret", nil),
	}

	tableName := fmt.Sprintf("workspace_scope_%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s", tableName))
	})

	raw, err := json.Marshal(map[string]any{
		"email":          "workspace-admin@example.com",
		"password":       "StrongPass123!",
		"workspace_name": "Launch Project",
		"mode":           "migrate",
		"migration": map[string]any{
			"source_kind": "csv",
			"table_name":  tableName,
			"raw_input":   "id,name\n1,Ana\n2,Luis",
			"import_rows": true,
		},
	})
	require.NoError(t, err)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/system/setup", bytes.NewReader(raw))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = h.SetupSystem(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var payload struct {
		WorkspaceID   string `json:"workspace_id"`
		WorkspaceName string `json:"workspace_name"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.NotEmpty(t, payload.WorkspaceID)
	assert.Equal(t, "Launch Project", payload.WorkspaceName)

	var collectionWorkspaceID string
	err = db.Pool.QueryRow(context.Background(), `
		SELECT COALESCE(workspace_id::text, '')
		FROM _v_collections
		WHERE name = $1
	`, tableName).Scan(&collectionWorkspaceID)
	require.NoError(t, err)
	assert.Equal(t, payload.WorkspaceID, collectionWorkspaceID)

	var workspaceCount int
	err = db.Pool.QueryRow(context.Background(), `
		SELECT COUNT(*)
		FROM _v_workspaces
	`).Scan(&workspaceCount)
	require.NoError(t, err)
	assert.Equal(t, 1, workspaceCount)
}

func TestWorkspaceBootstrap_AdoptsLegacyGlobalMetadata(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	userID := insertLegacyAdminUser(t, db, "legacy-bootstrap@example.com")
	legacyTableName := fmt.Sprintf("legacy_scope_%d", time.Now().UnixNano())

	_, err := db.Pool.Exec(context.Background(), `
		INSERT INTO _v_collections (name, display_name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled)
		VALUES ($1, $2, $3::jsonb, 'auth', 'admin', FALSE, '', FALSE)
	`, legacyTableName, "Legacy Scope", `[{"name":"id","type":"text"}]`)
	require.NoError(t, err)

	_, err = db.Pool.Exec(context.Background(), `
		INSERT INTO _v_table_views (user_id, workspace_id, table_name, name, config, is_default)
		VALUES ($1, NULL, $2, 'Default', '{}'::jsonb, TRUE)
	`, userID, legacyTableName)
	require.NoError(t, err)

	var apiKeyID string
	err = db.Pool.QueryRow(context.Background(), `
		INSERT INTO _v_api_keys (name, key_hash, prefix, role, is_active)
		VALUES ('Legacy Secret', 'legacy_hash_value', 'legacy_key', 'service_role', TRUE)
		RETURNING id
	`).Scan(&apiKeyID)
	require.NoError(t, err)

	_, err = db.Pool.Exec(context.Background(), `
		INSERT INTO _v_api_key_events (api_key_id, workspace_id, action, actor_user_id, details)
		VALUES ($1, NULL, 'create', $2, '{}'::jsonb)
	`, apiKeyID, userID)
	require.NoError(t, err)

	handler := NewWorkspaceHandler(core.NewWorkspaceService(db), nil)
	payload, rec := performWorkspaceBootstrapRequest(t, handler, userID, "admin")

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.True(t, payload.BootstrapApplied)
	require.NotEmpty(t, payload.WorkspaceID)
	assert.Equal(t, "Primary Project", payload.WorkspaceName)
	assert.Equal(t, "bootstrapped_legacy", payload.Resolution)

	assertWorkspaceScopedCount(t, db, "_v_collections", payload.WorkspaceID, "name = $2", legacyTableName)
	assertWorkspaceScopedCount(t, db, "_v_table_views", payload.WorkspaceID, "table_name = $2", legacyTableName)
	assertWorkspaceScopedCount(t, db, "_v_api_keys", payload.WorkspaceID, "id = $2::uuid", apiKeyID)
	assertWorkspaceScopedCount(t, db, "_v_api_key_events", payload.WorkspaceID, "api_key_id = $2::uuid", apiKeyID)
}

func TestWorkspaceBootstrap_IsIdempotentWhenWorkspaceAlreadyExists(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	userID := insertLegacyAdminUser(t, db, "legacy-existing@example.com")
	service := core.NewWorkspaceService(db)

	workspace, err := service.CreateWorkspace(context.Background(), "Existing Project", userID)
	require.NoError(t, err)
	require.NotNil(t, workspace)

	handler := NewWorkspaceHandler(service, nil)
	payload, rec := performWorkspaceBootstrapRequest(t, handler, userID, "admin")

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.False(t, payload.BootstrapApplied)
	assert.Equal(t, workspace.ID, payload.WorkspaceID)
	assert.Equal(t, workspace.Name, payload.WorkspaceName)
	assert.Equal(t, "existing_membership", payload.Resolution)

	var workspaceCount int
	err = db.Pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM _v_workspaces`).Scan(&workspaceCount)
	require.NoError(t, err)
	assert.Equal(t, 1, workspaceCount)
}

func TestWorkspaceBootstrap_RequiresExistingMembershipWhenInstallationAlreadyHasWorkspace(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	ownerUserID := insertLegacyAdminUser(t, db, "existing-owner@example.com")
	callerUserID := insertLegacyAdminUser(t, db, "no-membership@example.com")
	service := core.NewWorkspaceService(db)

	workspace, err := service.CreateWorkspace(context.Background(), "Scoped Project", ownerUserID)
	require.NoError(t, err)
	require.NotNil(t, workspace)

	handler := NewWorkspaceHandler(service, nil)
	payload, rec := performWorkspaceBootstrapRequest(t, handler, callerUserID, "admin")

	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.False(t, payload.BootstrapApplied)
	assert.Equal(t, "workspace_access_required", payload.Resolution)
	assert.Equal(t, "WORKSPACE_ACCESS_REQUIRED", payload.ErrorCode)
	assert.NotEmpty(t, payload.Error)

	var workspaceCount int
	err = db.Pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM _v_workspaces`).Scan(&workspaceCount)
	require.NoError(t, err)
	assert.Equal(t, 1, workspaceCount)

	var memberCount int
	err = db.Pool.QueryRow(context.Background(), `
		SELECT COUNT(*)
		FROM _v_workspace_members
		WHERE workspace_id = $1 AND user_id = $2
	`, workspace.ID, callerUserID).Scan(&memberCount)
	require.NoError(t, err)
	assert.Equal(t, 0, memberCount)
}

func TestWorkspaceBootstrap_NonAdminStillRequiresMembershipWhenWorkspaceExists(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	ownerUserID := insertLegacyAdminUser(t, db, "existing-owner-2@example.com")
	callerUserID := insertLegacyAdminUser(t, db, "no-membership-2@example.com")
	service := core.NewWorkspaceService(db)

	workspace, err := service.CreateWorkspace(context.Background(), "Scoped Project", ownerUserID)
	require.NoError(t, err)
	require.NotNil(t, workspace)

	handler := NewWorkspaceHandler(service, nil)
	payload, rec := performWorkspaceBootstrapRequest(t, handler, callerUserID, "viewer")

	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.False(t, payload.BootstrapApplied)
	assert.Equal(t, "workspace_access_required", payload.Resolution)
	assert.Equal(t, "WORKSPACE_ACCESS_REQUIRED", payload.ErrorCode)
	assert.NotEmpty(t, payload.Error)
}

func performWorkspaceBootstrapRequest(t *testing.T, handler *WorkspaceHandler, userID, role string) (workspaceBootstrapResponse, *httptest.ResponseRecorder) {
	t.Helper()

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/bootstrap", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user_id", userID)
	c.Set("role", role)

	err := handler.Bootstrap(c)
	require.NoError(t, err)

	var payload workspaceBootstrapResponse
	if rec.Body.Len() > 0 {
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	}

	return payload, rec
}

func assertWorkspaceScopedCount(t *testing.T, db *data.DB, tableName, workspaceID, extraPredicate string, arg any) {
	t.Helper()

	var count int
	query := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM %s
		WHERE COALESCE(workspace_id::text, '') = $1
		  AND %s
	`, tableName, extraPredicate)
	err := db.Pool.QueryRow(context.Background(), query, workspaceID, arg).Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "expected %s row to be scoped to workspace %s", tableName, workspaceID)
}

func setupWorkspaceBootstrapTestDB(t *testing.T) *data.DB {
	t.Helper()

	db := setupSystemTestDB(t)

	_, err := db.Pool.Exec(context.Background(), `
		TRUNCATE TABLE
			_v_api_key_events,
			_v_api_keys,
			_v_table_views,
			_v_workspace_members,
			_v_workspaces,
			_v_collections
		RESTART IDENTITY CASCADE
	`)
	require.NoError(t, err)

	return db
}

func insertLegacyAdminUser(t *testing.T, db *data.DB, email string) string {
	t.Helper()

	var userID string
	err := db.Pool.QueryRow(context.Background(), `
		INSERT INTO _v_users (email, password_hash, role)
		VALUES ($1, 'legacy_hash', 'admin')
		RETURNING id
	`, email).Scan(&userID)
	require.NoError(t, err)
	return userID
}
