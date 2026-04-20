package core

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type WorkspaceService struct {
	db *data.DB
}

const workspaceBootstrapAdvisoryLockKey = int64(2026040401)

var ErrWorkspaceBootstrapAccessRequired = errors.New("workspace bootstrap requires access to an existing workspace")

var workspaceSlugPattern = regexp.MustCompile("[^a-z0-9]+")

func NewWorkspaceService(db *data.DB) *WorkspaceService {
	return &WorkspaceService{db: db}
}

func (s *WorkspaceService) GetDB() *data.DB {
	return s.db
}

// FirstWorkspaceInInstallation returns the oldest workspace in the installation.
func (s *WorkspaceService) FirstWorkspaceInInstallation(ctx context.Context) (*Workspace, error) {
	workspace, err := firstWorkspaceInInstallationTx(ctx, s.db.Pool)
	if err != nil {
		return nil, err
	}
	return workspace, nil
}

// CreateWorkspace creates a new isolated environment and assigns an owner
func (s *WorkspaceService) CreateWorkspace(ctx context.Context, name, ownerID string) (*Workspace, error) {
	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	ws, err := CreateWorkspaceTx(ctx, tx, name, ownerID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return ws, nil
}

// ListWorkspacesForUser returns all workspaces where the user is a member
func (s *WorkspaceService) ListWorkspacesForUser(ctx context.Context, userID string) ([]Workspace, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT w.id, w.name, w.slug, w.config, w.created_at, w.updated_at
		FROM _v_workspaces w
		JOIN _v_workspace_members m ON w.id = m.workspace_id
		WHERE m.user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	workspaces := []Workspace{}
	for rows.Next() {
		var ws Workspace
		if err := rows.Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Config, &ws.CreatedAt, &ws.UpdatedAt); err != nil {
			return nil, err
		}
		workspaces = append(workspaces, ws)
	}
	return workspaces, nil
}

// UpdateWorkspace updates workspace metadata
func (s *WorkspaceService) UpdateWorkspace(ctx context.Context, id, name string, config map[string]interface{}) error {
	_, err := s.db.Pool.Exec(ctx, `
		UPDATE _v_workspaces 
		SET name = $1, config = $2, updated_at = NOW()
		WHERE id = $3
	`, name, config, id)
	return err
}

// DeleteWorkspace removes a workspace and all its members
func (s *WorkspaceService) DeleteWorkspace(ctx context.Context, id string) error {
	_, err := s.db.Pool.Exec(ctx, "DELETE FROM _v_workspaces WHERE id = $1", id)
	return err
}

// GetWorkspaceMembers returns all members of a workspace
func (s *WorkspaceService) GetWorkspaceMembers(ctx context.Context, workspaceID string) ([]map[string]interface{}, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT m.user_id, u.email, m.role, m.joined_at
		FROM _v_workspace_members m
		JOIN _v_users u ON m.user_id = u.id
		WHERE m.workspace_id = $1
	`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []map[string]interface{}
	for rows.Next() {
		var userID, email, role string
		var joinedAt interface{}
		if err := rows.Scan(&userID, &email, &role, &joinedAt); err != nil {
			return nil, err
		}
		members = append(members, map[string]interface{}{
			"user_id":   userID,
			"email":     email,
			"role":      role,
			"joined_at": joinedAt,
		})
	}
	return members, nil
}

// AddWorkspaceMember adds or updates a member's role in a workspace
func (s *WorkspaceService) AddWorkspaceMember(ctx context.Context, workspaceID, userID, role string) error {
	_, err := s.db.Pool.Exec(ctx, `
		INSERT INTO _v_workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
	`, workspaceID, userID, role)
	return err
}

// RemoveWorkspaceMember removes a member from a workspace
func (s *WorkspaceService) RemoveWorkspaceMember(ctx context.Context, workspaceID, userID string) error {
	_, err := s.db.Pool.Exec(ctx, `
		DELETE FROM _v_workspace_members 
		WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID)
	return err
}

// GenerateSlug creates a URL-friendly version of the name
func (s *WorkspaceService) GenerateSlug(name string) string {
	return GenerateWorkspaceSlug(name)
}

// GenerateWorkspaceSlug creates a URL-friendly workspace slug.
func GenerateWorkspaceSlug(name string) string {
	slug := strings.ToLower(strings.TrimSpace(name))
	slug = workspaceSlugPattern.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		return "project"
	}
	return slug
}

// CreateWorkspaceTx creates a workspace and owner membership within an existing transaction.
func CreateWorkspaceTx(ctx context.Context, tx pgx.Tx, name, ownerID string) (*Workspace, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return nil, errors.New("workspace name is required")
	}
	if strings.TrimSpace(ownerID) == "" {
		return nil, errors.New("workspace owner is required")
	}

	baseSlug := GenerateWorkspaceSlug(trimmedName)
	var ws Workspace
	inserted := false

	for attempt := 1; attempt <= 25; attempt++ {
		slug := baseSlug
		if attempt > 1 {
			slug = fmt.Sprintf("%s-%d", baseSlug, attempt)
		}

		err := tx.QueryRow(ctx, `
			INSERT INTO _v_workspaces (name, slug)
			VALUES ($1, $2)
			RETURNING id, name, slug, config, created_at, updated_at
		`, trimmedName, slug).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Config, &ws.CreatedAt, &ws.UpdatedAt)
		if err == nil {
			inserted = true
			break
		}

		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
			return nil, fmt.Errorf("failed to create workspace: %w", err)
		}
	}

	if !inserted {
		return nil, fmt.Errorf("failed to create workspace: could not find a unique slug for %q", trimmedName)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO _v_workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, $3)
	`, ws.ID, ownerID, "owner"); err != nil {
		return nil, fmt.Errorf("failed to add workspace owner: %w", err)
	}

	return &ws, nil
}

// BootstrapLegacyWorkspace creates the first workspace for legacy installs and adopts global metadata.
func (s *WorkspaceService) BootstrapLegacyWorkspace(ctx context.Context, userID string) (*Workspace, bool, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, false, errors.New("workspace bootstrap requires a user")
	}

	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", workspaceBootstrapAdvisoryLockKey); err != nil {
		return nil, false, fmt.Errorf("failed to lock workspace bootstrap: %w", err)
	}

	existingWorkspace, err := firstWorkspaceForUserTx(ctx, tx, userID)
	if err != nil {
		return nil, false, err
	}
	if existingWorkspace != nil {
		if err := tx.Commit(ctx); err != nil {
			return nil, false, err
		}
		return existingWorkspace, false, nil
	}
	if exists, err := anyWorkspaceExistsTx(ctx, tx); err != nil {
		return nil, false, err
	} else if exists {
		return nil, false, ErrWorkspaceBootstrapAccessRequired
	}

	workspace, err := CreateWorkspaceTx(ctx, tx, "Primary Project", userID)
	if err != nil {
		return nil, false, err
	}

	if err := adoptLegacyWorkspaceMetadataTx(ctx, tx, workspace.ID); err != nil {
		return nil, false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}

	return workspace, true, nil
}

// AttachUserToDefaultWorkspace links a user to the first workspace in the installation.
// It is intended for instance-level admins who were created after initial bootstrap.
func (s *WorkspaceService) AttachUserToDefaultWorkspace(ctx context.Context, userID, role string) (*Workspace, bool, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, false, errors.New("workspace attach requires a user")
	}

	normalizedRole := strings.ToLower(strings.TrimSpace(role))
	if normalizedRole == "" {
		normalizedRole = "admin"
	}

	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", workspaceBootstrapAdvisoryLockKey); err != nil {
		return nil, false, fmt.Errorf("failed to lock default workspace attach: %w", err)
	}

	existingWorkspace, err := firstWorkspaceForUserTx(ctx, tx, userID)
	if err != nil {
		return nil, false, err
	}
	if existingWorkspace != nil {
		if err := tx.Commit(ctx); err != nil {
			return nil, false, err
		}
		return existingWorkspace, false, nil
	}

	workspace, err := firstWorkspaceInInstallationTx(ctx, tx)
	if err != nil {
		return nil, false, err
	}
	if workspace == nil {
		return nil, false, ErrWorkspaceBootstrapAccessRequired
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO _v_workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (workspace_id, user_id) DO NOTHING
	`, workspace.ID, userID, normalizedRole); err != nil {
		return nil, false, fmt.Errorf("failed to attach user to default workspace: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}

	return workspace, true, nil
}

// IsMember checks if a user belongs to a workspace
func (s *WorkspaceService) IsMember(ctx context.Context, workspaceID, userID string) (bool, string, error) {
	var role string
	err := s.db.Pool.QueryRow(ctx, `
		SELECT role FROM _v_workspace_members
		WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID).Scan(&role)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, "", nil
		}
		return false, "", fmt.Errorf("lookup workspace membership: %w", err)
	}
	return true, role, nil
}

type workspaceRowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func firstWorkspaceForUserTx(ctx context.Context, querier workspaceRowQuerier, userID string) (*Workspace, error) {
	var ws Workspace
	err := querier.QueryRow(ctx, `
		SELECT w.id, w.name, w.slug, w.config, w.created_at, w.updated_at
		FROM _v_workspaces w
		JOIN _v_workspace_members m ON w.id = m.workspace_id
		WHERE m.user_id = $1
		ORDER BY w.created_at ASC, w.id ASC
		LIMIT 1
	`, userID).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Config, &ws.CreatedAt, &ws.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lookup initial workspace: %w", err)
	}
	return &ws, nil
}

func anyWorkspaceExistsTx(ctx context.Context, querier workspaceRowQuerier) (bool, error) {
	var exists bool
	err := querier.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM _v_workspaces
		)
	`).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("lookup installation workspaces: %w", err)
	}
	return exists, nil
}

func firstWorkspaceInInstallationTx(ctx context.Context, querier workspaceRowQuerier) (*Workspace, error) {
	var ws Workspace
	err := querier.QueryRow(ctx, `
		SELECT id, name, slug, config, created_at, updated_at
		FROM _v_workspaces
		ORDER BY created_at ASC, id ASC
		LIMIT 1
	`).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Config, &ws.CreatedAt, &ws.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lookup default workspace: %w", err)
	}
	return &ws, nil
}

func adoptLegacyWorkspaceMetadataTx(ctx context.Context, tx pgx.Tx, workspaceID string) error {
	assignments := []struct {
		tableName string
		query     string
	}{
		{
			tableName: "_v_collections",
			query: `
				UPDATE _v_collections
				SET workspace_id = $1,
				    updated_at = NOW()
				WHERE workspace_id IS NULL
				  AND name NOT LIKE '\_v\_%' ESCAPE '\'
				  AND name NOT LIKE '\_ozy\_%' ESCAPE '\'
			`,
		},
		{
			tableName: "_v_table_views",
			query: `
				UPDATE _v_table_views
				SET workspace_id = $1,
				    updated_at = NOW()
				WHERE workspace_id IS NULL
			`,
		},
		{
			tableName: "_v_api_keys",
			query: `
				UPDATE _v_api_keys
				SET workspace_id = $1
				WHERE workspace_id IS NULL
			`,
		},
		{
			tableName: "_v_api_key_events",
			query: `
				UPDATE _v_api_key_events
				SET workspace_id = $1
				WHERE workspace_id IS NULL
			`,
		},
		{
			tableName: "_v_storage_objects",
			query: `
				UPDATE _v_storage_objects
				SET workspace_id = $1,
				    updated_at = NOW()
				WHERE workspace_id IS NULL
			`,
		},
		{
			tableName: "_v_storage_upload_sessions",
			query: `
				UPDATE _v_storage_upload_sessions
				SET workspace_id = $1
				WHERE workspace_id IS NULL
			`,
		},
		{
			tableName: "_v_audit_logs",
			query: `
				UPDATE _v_audit_logs
				SET workspace_id = $1
				WHERE workspace_id IS NULL
			`,
		},
	}

	for _, assignment := range assignments {
		hasWorkspaceColumn, err := tableHasColumnTx(ctx, tx, assignment.tableName, "workspace_id")
		if err != nil {
			return err
		}
		if !hasWorkspaceColumn {
			continue
		}
		if _, err := tx.Exec(ctx, assignment.query, workspaceID); err != nil {
			return fmt.Errorf("failed to scope legacy metadata in %s: %w", assignment.tableName, err)
		}
	}

	return nil
}

func tableHasColumnTx(ctx context.Context, tx pgx.Tx, tableName, columnName string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public'
			  AND table_name = $1
			  AND column_name = $2
		)
	`, tableName, columnName).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("inspect %s.%s: %w", tableName, columnName, err)
	}
	return exists, nil
}
