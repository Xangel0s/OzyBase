package api

import (
	"context"
	"fmt"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func workspaceIDFromRequestHeaders(c echo.Context) string {
	if c == nil || c.Request() == nil {
		return ""
	}

	workspaceID := strings.TrimSpace(c.Request().Header.Get("X-Ozy-Project-ID"))
	if workspaceID == "" {
		workspaceID = strings.TrimSpace(c.Request().Header.Get("X-Workspace-Id"))
	}
	return workspaceID
}

func autoAttachUserToWorkspace(ctx context.Context, db *data.DB, workspaceID, userID string) error {
	if db == nil || db.Pool == nil {
		return fmt.Errorf("database connection is unavailable")
	}

	workspaceID = strings.TrimSpace(workspaceID)
	userID = strings.TrimSpace(userID)
	if workspaceID == "" || userID == "" {
		return fmt.Errorf("workspace_id and user_id are required")
	}
	if _, err := uuid.Parse(workspaceID); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}
	if _, err := uuid.Parse(userID); err != nil {
		return fmt.Errorf("invalid user id: %w", err)
	}

	var workspaceExists bool
	if err := db.Pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM _v_workspaces
			WHERE id = $1
		)
	`, workspaceID).Scan(&workspaceExists); err != nil {
		return fmt.Errorf("failed to check workspace existence: %w", err)
	}
	if !workspaceExists {
		return fmt.Errorf("workspace %s not found", workspaceID)
	}

	if _, err := db.Pool.Exec(ctx, `
		INSERT INTO _v_workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, 'user')
		ON CONFLICT (workspace_id, user_id) DO NOTHING
	`, workspaceID, userID); err != nil {
		return fmt.Errorf("failed to create workspace membership: %w", err)
	}

	return nil
}
