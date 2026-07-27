package data

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DB wraps the PostgreSQL connection pool
type DB struct {
	Pool *pgxpool.Pool

	columnCacheMu  sync.RWMutex
	columnCache    map[string]columnCacheEntry
	columnCacheTTL time.Duration
}

type columnCacheEntry struct {
	columns   map[string]bool
	types     map[string]string
	expiresAt time.Time
}

// Connect establishes a connection pool to PostgreSQL
func Connect(ctx context.Context, databaseURL string) (*DB, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to parse database config: %w", err)
	}

	// Dynamic admin queries change table shapes frequently (ALTER TABLE, add/drop columns).
	// Avoid cached statement descriptions globally to prevent stale cached-plan failures such as:
	// SQLSTATE 0A000: cached plan must not change result type.
	//
	// DescribeExec keeps dynamic-schema safety without forcing []byte to bytea (Exec mode),
	// which can break json/jsonb writes in existing flows.
	poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeDescribeExec

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	// Verify connection is working
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	return &DB{
		Pool:           pool,
		columnCache:    map[string]columnCacheEntry{},
		columnCacheTTL: 30 * time.Second,
	}, nil
}

// Close gracefully closes the database connection pool
func (db *DB) Close() {
	if db.Pool != nil {
		db.Pool.Close()
	}
}

// Health checks if the database connection is healthy
func (db *DB) Health(ctx context.Context) error {
	return db.Pool.Ping(ctx)
}

// ListSchemas returns a list of all schema names in the database
func (db *DB) ListSchemas(ctx context.Context) ([]string, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT schema_name
		FROM information_schema.schemata
		WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
		ORDER BY schema_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var schemas []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err == nil {
			schemas = append(schemas, s)
		}
	}
	return schemas, nil
}

// ListTables returns a list of user table names in the public schema
func (db *DB) ListTables(ctx context.Context) ([]string, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT name FROM ozy_internal.list_tables() WHERE NOT is_system
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err == nil {
			tables = append(tables, t)
		}
	}
	return tables, nil
}

// HasColumn checks if a specific table has a specific column
func (db *DB) HasColumn(ctx context.Context, tableName, columnName string) bool {
	var exists bool
	err := db.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ozy_internal.get_table_columns($1) WHERE name = $2
		)
	`, tableName, columnName).Scan(&exists)
	if err != nil {
		return false
	}
	return exists
}

// GetTableColumns returns a map of column names for a specific table
func (db *DB) GetTableColumns(ctx context.Context, tableName string) (map[string]bool, error) {
	if !IsValidIdentifier(tableName) {
		return nil, fmt.Errorf("invalid table name")
	}

	if cached, ok := db.getColumnCacheEntry(tableName); ok {
		return cloneColumnsMap(cached.columns), nil
	}

	rows, err := db.Pool.Query(ctx, `
		SELECT name, type FROM ozy_internal.get_table_columns($1)
	`, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols := make(map[string]bool)
	types := make(map[string]string)
	for rows.Next() {
		var name string
		var dataType string
		if err := rows.Scan(&name, &dataType); err == nil {
			cols[name] = true
			types[name] = dataType
		}
	}
	db.setColumnCache(tableName, cols, types)
	return cols, nil
}

// GetTableColumnTypes returns a map of column names to PostgreSQL data types for a specific table.
func (db *DB) GetTableColumnTypes(ctx context.Context, tableName string) (map[string]string, error) {
	if !IsValidIdentifier(tableName) {
		return nil, fmt.Errorf("invalid table name")
	}

	if cached, ok := db.getColumnCacheEntry(tableName); ok && len(cached.types) > 0 {
		return cloneStringMap(cached.types), nil
	}

	if _, err := db.GetTableColumns(ctx, tableName); err != nil {
		return nil, err
	}

	if cached, ok := db.getColumnCacheEntry(tableName); ok {
		return cloneStringMap(cached.types), nil
	}

	return map[string]string{}, nil
}

// GetSinglePrimaryKeyColumn returns the name of the primary key column when the table
// exposes exactly one primary key column. Composite keys are treated as unsupported
// row identities for CRUD operations that address a single `:id` path segment.
func (db *DB) GetSinglePrimaryKeyColumn(ctx context.Context, tableName string) (string, error) {
	if !IsValidIdentifier(tableName) {
		return "", fmt.Errorf("invalid table name")
	}

	rows, err := db.Pool.Query(ctx, `
		SELECT name FROM ozy_internal.get_table_columns($1) WHERE is_pk
	`, tableName)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	var columns []string
	for rows.Next() {
		var columnName string
		if err := rows.Scan(&columnName); err != nil {
			return "", err
		}
		columns = append(columns, columnName)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}

	if len(columns) == 0 {
		return "", nil
	}
	if len(columns) > 1 {
		return "", fmt.Errorf("table %s uses a composite primary key", tableName)
	}
	return columns[0], nil
}

// InvalidateTableColumnCache clears cached table column metadata after schema changes.
func (db *DB) InvalidateTableColumnCache(tableName string) {
	if db == nil || tableName == "" {
		return
	}
	db.columnCacheMu.Lock()
	defer db.columnCacheMu.Unlock()
	if db.columnCache == nil {
		return
	}
	delete(db.columnCache, tableName)
}

func (db *DB) getColumnCacheEntry(tableName string) (columnCacheEntry, bool) {
	if db == nil || tableName == "" {
		return columnCacheEntry{}, false
	}
	db.columnCacheMu.RLock()
	entry, ok := db.columnCache[tableName]
	db.columnCacheMu.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return columnCacheEntry{}, false
	}
	return columnCacheEntry{
		columns:   cloneColumnsMap(entry.columns),
		types:     cloneStringMap(entry.types),
		expiresAt: entry.expiresAt,
	}, true
}

func (db *DB) setColumnCache(tableName string, cols map[string]bool, types map[string]string) {
	if db == nil || tableName == "" {
		return
	}
	db.columnCacheMu.Lock()
	defer db.columnCacheMu.Unlock()
	if db.columnCache == nil {
		db.columnCache = map[string]columnCacheEntry{}
	}
	ttl := db.columnCacheTTL
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	db.columnCache[tableName] = columnCacheEntry{
		columns:   cloneColumnsMap(cols),
		types:     cloneStringMap(types),
		expiresAt: time.Now().Add(ttl),
	}
}

func cloneColumnsMap(input map[string]bool) map[string]bool {
	out := make(map[string]bool, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func cloneStringMap(input map[string]string) map[string]string {
	out := make(map[string]string, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

// EnsureDefaultWorkspace checks if at least one workspace exists in single-tenant mode.
// If none exist, it creates a "Default" workspace and assigns the first admin user as owner.
func (db *DB) EnsureDefaultWorkspace(ctx context.Context) (string, error) {
	var workspaceID string
	err := db.Pool.QueryRow(ctx, `SELECT id::text FROM _v_workspaces ORDER BY created_at LIMIT 1`).Scan(&workspaceID)
	if err == nil {
		// Auto-heal any orphaned collection metadata to the primary workspace ID
		_, _ = db.Pool.Exec(ctx, `
			UPDATE _v_collections 
			SET workspace_id = $1 
			WHERE workspace_id IS NULL OR workspace_id = '' OR workspace_id NOT IN (SELECT id::text FROM _v_workspaces)
		`, workspaceID)
		return workspaceID, nil
	}

	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := tx.QueryRow(ctx, `
		INSERT INTO _v_workspaces (name, slug, config)
		VALUES ('Default', 'default', '{"is_default":true}')
		ON CONFLICT (slug) DO UPDATE SET name = 'Default'
		RETURNING id::text
	`).Scan(&workspaceID); err != nil {
		return "", fmt.Errorf("failed to create default workspace: %w", err)
	}

	// Find the first admin user and assign as owner
	var userID string
	if err := tx.QueryRow(ctx, `
		SELECT id::text FROM _v_users WHERE role = 'admin' ORDER BY created_at LIMIT 1
	`).Scan(&userID); err == nil {
		_, _ = tx.Exec(ctx, `
			INSERT INTO _v_workspace_members (workspace_id, user_id, role)
			VALUES ($1, $2, 'owner')
			ON CONFLICT (workspace_id, user_id) DO NOTHING
		`, workspaceID, userID)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("failed to commit default workspace: %w", err)
	}

	return workspaceID, nil
}
