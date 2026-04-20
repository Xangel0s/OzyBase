package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWorkspaceRequestAccess_PreventsDuplicatePendingRequests(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	service := core.NewWorkspaceService(db)

	ownerUserID := insertLegacyAdminUser(t, db, "owner-dupe@example.com")
	requesterUserID := insertLegacyAdminUser(t, db, "requester-dupe@example.com")

	workspace, err := service.CreateWorkspace(context.Background(), "PRO-DUPE", ownerUserID)
	require.NoError(t, err)
	require.NotNil(t, workspace)

	handler := NewWorkspaceHandler(service, nil)
	e := echo.New()

	firstReq := httptest.NewRequest(http.MethodPost, "/api/workspaces/request-access", bytes.NewBufferString(`{"workspace_id":"`+workspace.ID+`","message":"first"}`))
	firstReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	firstRec := httptest.NewRecorder()
	firstCtx := e.NewContext(firstReq, firstRec)
	firstCtx.Set("user_id", requesterUserID)
	firstCtx.Set("email", "requester-dupe@example.com")

	err = handler.RequestAccess(firstCtx)
	require.NoError(t, err)
	require.Equal(t, http.StatusAccepted, firstRec.Code, firstRec.Body.String())

	secondReq := httptest.NewRequest(http.MethodPost, "/api/workspaces/request-access", bytes.NewBufferString(`{"workspace_id":"`+workspace.ID+`","message":"second"}`))
	secondReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	secondRec := httptest.NewRecorder()
	secondCtx := e.NewContext(secondReq, secondRec)
	secondCtx.Set("user_id", requesterUserID)
	secondCtx.Set("email", "requester-dupe@example.com")

	err = handler.RequestAccess(secondCtx)
	require.NoError(t, err)
	require.Equal(t, http.StatusConflict, secondRec.Code, secondRec.Body.String())
}

func TestWorkspaceAccessRequestDecision_ApproveCreatesMembership(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	service := core.NewWorkspaceService(db)

	ownerUserID := insertLegacyAdminUser(t, db, "owner-approve@example.com")
	adminUserID := insertLegacyAdminUser(t, db, "admin-approve@example.com")
	requesterUserID := insertLegacyAdminUser(t, db, "requester-approve@example.com")

	workspace, err := service.CreateWorkspace(context.Background(), "PRO-APPROVE", ownerUserID)
	require.NoError(t, err)
	require.NotNil(t, workspace)

	err = service.AddWorkspaceMember(context.Background(), workspace.ID, adminUserID, "admin")
	require.NoError(t, err)

	var requestID string
	err = db.Pool.QueryRow(context.Background(), `
		INSERT INTO _v_access_requests (user_id, workspace_id, message, status)
		VALUES ($1, $2, 'please approve', 'PENDING')
		RETURNING id::text
	`, requesterUserID, workspace.ID).Scan(&requestID)
	require.NoError(t, err)

	handler := NewWorkspaceHandler(service, nil)
	e := echo.New()
	decisionReq := httptest.NewRequest(http.MethodPatch, "/api/project/security/requests/"+requestID, bytes.NewBufferString(`{"decision":"APPROVED","role":"member"}`))
	decisionReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	decisionRec := httptest.NewRecorder()
	decisionCtx := e.NewContext(decisionReq, decisionRec)
	decisionCtx.SetPath("/api/project/security/requests/:id")
	decisionCtx.SetParamNames("id")
	decisionCtx.SetParamValues(requestID)
	decisionCtx.Set("workspace_id", workspace.ID)
	decisionCtx.Set("user_id", adminUserID)

	err = handler.DecideAccessRequest(decisionCtx)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, decisionRec.Code, decisionRec.Body.String())

	isMember, role, err := service.IsMember(context.Background(), workspace.ID, requesterUserID)
	require.NoError(t, err)
	assert.True(t, isMember)
	assert.Equal(t, "member", role)

	var status string
	err = db.Pool.QueryRow(context.Background(), `
		SELECT status::text
		FROM _v_access_requests
		WHERE id = $1::uuid
	`, requestID).Scan(&status)
	require.NoError(t, err)
	assert.Equal(t, "APPROVED", status)
}

func TestWorkspaceAccessRequestDecision_RejectDoesNotCreateMembership(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	service := core.NewWorkspaceService(db)

	ownerUserID := insertLegacyAdminUser(t, db, "owner-reject@example.com")
	adminUserID := insertLegacyAdminUser(t, db, "admin-reject@example.com")
	requesterUserID := insertLegacyAdminUser(t, db, "requester-reject@example.com")

	workspace, err := service.CreateWorkspace(context.Background(), "PRO-REJECT", ownerUserID)
	require.NoError(t, err)
	require.NotNil(t, workspace)

	err = service.AddWorkspaceMember(context.Background(), workspace.ID, adminUserID, "admin")
	require.NoError(t, err)

	var requestID string
	err = db.Pool.QueryRow(context.Background(), `
		INSERT INTO _v_access_requests (user_id, workspace_id, message, status)
		VALUES ($1, $2, 'please reject', 'PENDING')
		RETURNING id::text
	`, requesterUserID, workspace.ID).Scan(&requestID)
	require.NoError(t, err)

	handler := NewWorkspaceHandler(service, nil)
	e := echo.New()
	decisionReq := httptest.NewRequest(http.MethodPatch, "/api/project/security/requests/"+requestID, bytes.NewBufferString(`{"decision":"REJECTED"}`))
	decisionReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	decisionRec := httptest.NewRecorder()
	decisionCtx := e.NewContext(decisionReq, decisionRec)
	decisionCtx.SetPath("/api/project/security/requests/:id")
	decisionCtx.SetParamNames("id")
	decisionCtx.SetParamValues(requestID)
	decisionCtx.Set("workspace_id", workspace.ID)
	decisionCtx.Set("user_id", adminUserID)

	err = handler.DecideAccessRequest(decisionCtx)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, decisionRec.Code, decisionRec.Body.String())

	isMember, _, err := service.IsMember(context.Background(), workspace.ID, requesterUserID)
	require.NoError(t, err)
	assert.False(t, isMember)

	var status string
	err = db.Pool.QueryRow(context.Background(), `
		SELECT status::text
		FROM _v_access_requests
		WHERE id = $1::uuid
	`, requestID).Scan(&status)
	require.NoError(t, err)
	assert.Equal(t, "REJECTED", status)
}

func TestWorkspaceAccessRequestsList_ReturnsWorkspaceScopedRequests(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	service := core.NewWorkspaceService(db)

	ownerUserID := insertLegacyAdminUser(t, db, "owner-list@example.com")
	requesterUserID := insertLegacyAdminUser(t, db, "requester-list@example.com")

	workspace, err := service.CreateWorkspace(context.Background(), "PRO-LIST", ownerUserID)
	require.NoError(t, err)
	require.NotNil(t, workspace)

	_, err = db.Pool.Exec(context.Background(), `
		INSERT INTO _v_access_requests (user_id, workspace_id, message, status)
		VALUES ($1, $2, 'show me in list', 'PENDING')
	`, requesterUserID, workspace.ID)
	require.NoError(t, err)

	handler := NewWorkspaceHandler(service, nil)
	e := echo.New()
	listReq := httptest.NewRequest(http.MethodGet, "/api/project/security/requests", http.NoBody)
	listRec := httptest.NewRecorder()
	listCtx := e.NewContext(listReq, listRec)
	listCtx.Set("workspace_id", workspace.ID)
	listCtx.Set("user_id", ownerUserID)

	err = handler.ListAccessRequests(listCtx)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, listRec.Code, listRec.Body.String())

	var payload struct {
		Requests []map[string]any `json:"requests"`
	}
	require.NoError(t, json.Unmarshal(listRec.Body.Bytes(), &payload))
	require.Len(t, payload.Requests, 1)
	assert.Equal(t, "PENDING", payload.Requests[0]["status"])
	assert.Equal(t, workspace.ID, payload.Requests[0]["workspace_id"])
}

func TestWorkspaceAccessRequestsList_EmptyMessageDoesNotFail(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	service := core.NewWorkspaceService(db)

	ownerUserID := insertLegacyAdminUser(t, db, "owner-null-message@example.com")
	requesterUserID := insertLegacyAdminUser(t, db, "requester-null-message@example.com")

	workspace, err := service.CreateWorkspace(context.Background(), "PRO-LIST-NULL", ownerUserID)
	require.NoError(t, err)
	require.NotNil(t, workspace)

	_, err = db.Pool.Exec(context.Background(), `
		INSERT INTO _v_access_requests (user_id, workspace_id, message, status)
		VALUES ($1, $2, '', 'PENDING')
	`, requesterUserID, workspace.ID)
	require.NoError(t, err)

	handler := NewWorkspaceHandler(service, nil)
	e := echo.New()
	listReq := httptest.NewRequest(http.MethodGet, "/api/project/security/requests", http.NoBody)
	listRec := httptest.NewRecorder()
	listCtx := e.NewContext(listReq, listRec)
	listCtx.Set("workspace_id", workspace.ID)
	listCtx.Set("user_id", ownerUserID)

	err = handler.ListAccessRequests(listCtx)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, listRec.Code, listRec.Body.String())

	var payload struct {
		Requests []map[string]any `json:"requests"`
	}
	require.NoError(t, json.Unmarshal(listRec.Body.Bytes(), &payload))
	require.Len(t, payload.Requests, 1)
	assert.Equal(t, "", payload.Requests[0]["message"])
}
