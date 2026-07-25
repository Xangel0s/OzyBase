package api

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/stretchr/testify/require"
)

var (
	testDBPool     *data.DB
	testDBPoolOnce sync.Once
)

func TestMain(m *testing.M) {
	code := m.Run()
	if testDBPool != nil {
		testDBPool.Close()
	}
	os.Exit(code)
}

// setupSystemTestDB connects to the test database and truncates core tables.
// Tests are skipped when OZY_TEST_DATABASE_URL / DATABASE_URL are not set.
func setupSystemTestDB(t *testing.T) *data.DB {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	testDBPoolOnce.Do(func() {
		databaseURL := strings.TrimSpace(os.Getenv("OZY_TEST_DATABASE_URL"))
		if databaseURL == "" {
			databaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
		}
		if databaseURL == "" {
			return
		}
		db, err := data.Connect(ctx, databaseURL)
		if err != nil {
			panic(fmt.Sprintf("setupSystemTestDB connect: %v", err))
		}
		if err := db.RunMigrations(ctx); err != nil {
			panic(fmt.Sprintf("setupSystemTestDB migrations: %v", err))
		}
		testDBPool = db
	})

	if testDBPool == nil {
		t.Skip("set OZY_TEST_DATABASE_URL or DATABASE_URL to run integration tests")
	}

	_, err := testDBPool.Pool.Exec(ctx, `
		TRUNCATE TABLE
			_v_sessions,
			_v_users,
			_v_workspace_members,
			_v_workspaces,
			_v_collections,
			_v_api_keys,
			_v_api_key_events,
			_v_table_views
		RESTART IDENTITY CASCADE
	`)
	require.NoError(t, err)

	return testDBPool
}

// setupWorkspaceBootstrapTestDB calls setupSystemTestDB and additionally
// truncates the workspace-related tables for bootstrap tests.
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

// insertLegacyAdminUser inserts a minimal admin user row and returns its ID.
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
