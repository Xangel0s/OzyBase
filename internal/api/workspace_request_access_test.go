package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWorkspaceRequestAccess_SubmitsForNonMember(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	service := core.NewWorkspaceService(db)

	ownerUserID := insertLegacyAdminUser(t, db, "owner-request@example.com")
	requesterUserID := insertLegacyAdminUser(t, db, "requester@example.com")

	workspace, err := service.CreateWorkspace(context.Background(), "PRO1", ownerUserID)
	require.NoError(t, err)
	require.NotNil(t, workspace)

	handler := NewWorkspaceHandler(service, nil)
	e := echo.New()
	body := bytes.NewBufferString(`{"message":"Necesito acceso para auditoria"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/request-access", body)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user_id", requesterUserID)
	c.Set("email", "requester@example.com")

	err = handler.RequestAccess(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusAccepted, rec.Code, rec.Body.String())

	var payload map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	assert.Equal(t, "request_submitted", payload["status"])
	assert.Equal(t, workspace.ID, payload["workspace_id"])
	assert.Equal(t, workspace.Name, payload["workspace_name"])
}

func TestWorkspaceRequestAccess_RejectsOversizedMessage(t *testing.T) {
	db := setupWorkspaceBootstrapTestDB(t)
	service := core.NewWorkspaceService(db)

	ownerUserID := insertLegacyAdminUser(t, db, "owner-request-2@example.com")
	requesterUserID := insertLegacyAdminUser(t, db, "requester-2@example.com")

	workspace, err := service.CreateWorkspace(context.Background(), "PRO2", ownerUserID)
	require.NoError(t, err)
	require.NotNil(t, workspace)

	handler := NewWorkspaceHandler(service, nil)
	e := echo.New()
	oversized := strings.Repeat("a", 1001)
	body := bytes.NewBufferString(`{"message":"` + oversized + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/request-access", body)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user_id", requesterUserID)
	c.Set("email", "requester-2@example.com")

	err = handler.RequestAccess(c)
	require.NoError(t, err)
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())

	var payload map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	assert.Equal(t, "message must be 1000 characters or less", payload["error"])
}
