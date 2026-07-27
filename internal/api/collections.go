package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/Xangel0s/OzyBase/internal/version"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/labstack/echo/v4"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/language/display"
)

// Collection represents a collection in the system
type Collection struct {
	ID               string             `json:"id"`
	Name             string             `json:"name"`
	DisplayName      string             `json:"display_name,omitempty"`
	IsSystem         bool               `json:"is_system"`
	HasID            bool               `json:"has_id"`
	HasPrimaryID     bool               `json:"has_primary_id"`
	PrimaryKeyColumn string             `json:"primary_key_column,omitempty"`
	HasCreatedAt     bool               `json:"has_created_at"`
	HasUpdatedAt     bool               `json:"has_updated_at"`
	HasDeletedAt     bool               `json:"has_deleted_at"`
	Schema           []data.FieldSchema `json:"schema"`
	ListRule         string             `json:"list_rule"`
	CreateRule       string             `json:"create_rule"`
	RlsEnabled       bool               `json:"rls_enabled"`
	RlsRule          string             `json:"rls_rule"`
	RealtimeEnabled  bool               `json:"realtime_enabled"`
	WorkspaceID      string             `json:"workspace_id,omitempty"`
	CreatedAt        time.Time          `json:"created_at"`
	UpdatedAt        time.Time          `json:"updated_at"`
}

// CreateCollectionRequest represents the request to create a new collection
type CreateCollectionRequest struct {
	Name            string             `json:"name"`
	DisplayName     string             `json:"display_name"`
	Schema          []data.FieldSchema `json:"schema"`
	ListRule        string             `json:"list_rule"`   // "public", "auth", "admin"
	CreateRule      string             `json:"create_rule"` // "auth", "admin"
	RlsEnabled      bool               `json:"rls_enabled"`
	RlsForce        bool               `json:"rls_force"`
	RlsRule         string             `json:"rls_rule"`
	RlsPolicies     map[string]string  `json:"rls_policies"`
	RlsRoles        map[string][]string `json:"rls_roles"`
	RealtimeEnabled bool               `json:"realtime_enabled"`
	WorkspaceID     string             `json:"workspace_id"`
}

type UpdateCollectionRLSRequest struct {
	Name        string            `json:"name"`
	Enabled     bool              `json:"enabled"`
	RlsForce    *bool             `json:"rls_force,omitempty"`
	RlsRule     string            `json:"rls_rule"`
	RlsPolicies map[string]string `json:"rls_policies"`
	RlsRoles    map[string][]string `json:"rls_roles"`
}

type UpdateColumnRequest struct {
	NextName     string `json:"next_name"`
	Type         string `json:"type"`
	Required     *bool  `json:"required"`
	DefaultMode  string `json:"default_mode"`
	DefaultValue any    `json:"default_value"`
}

type UpdatePrimaryKeyRequest struct {
	Columns []string `json:"columns"`
}

type DuplicateCollectionRequest struct {
	Name     string `json:"name"`
	CopyData *bool  `json:"copy_data"`
}

type RenameCollectionRequest struct {
	NextName string `json:"next_name"`
}

func collectionRequestColumnTypes(schema []data.FieldSchema) map[string]string {
	columnTypes := make(map[string]string, len(schema))
	for _, field := range schema {
		if !data.IsValidIdentifier(field.Name) {
			continue
		}
		columnTypes[field.Name] = strings.TrimSpace(field.Type)
	}
	return columnTypes
}

var allowedRLSPolicyActions = map[string]struct{}{
	"select": {},
	"insert": {},
	"update": {},
	"delete": {},
}

func validateRLSPolicyActions(perAction map[string]string) error {
	for action := range perAction {
		key := strings.ToLower(strings.TrimSpace(action))
		if _, ok := allowedRLSPolicyActions[key]; !ok {
			return fmt.Errorf("invalid RLS policy action: %s", action)
		}
	}
	return nil
}

func validateRLSPolicyRoles(perAction map[string][]string) error {
	for action, roles := range perAction {
		key := strings.ToLower(strings.TrimSpace(action))
		if _, ok := allowedRLSPolicyActions[key]; !ok {
			return fmt.Errorf("invalid RLS policy action for roles: %s", action)
		}
		for _, role := range roles {
			normalizedRole := strings.ToLower(strings.TrimSpace(role))
			if normalizedRole == "" {
				continue
			}
			if normalizedRole == "public" {
				continue
			}
			if !data.IsValidIdentifier(normalizedRole) {
				return fmt.Errorf("invalid RLS role: %s", role)
			}
		}
	}
	return nil
}

func ensureRLSPolicyRolesExist(ctx context.Context, tx pgx.Tx, perAction map[string][]string) error {
	seen := map[string]struct{}{}
	for _, roles := range perAction {
		for _, role := range roles {
			normalizedRole := strings.ToLower(strings.TrimSpace(role))
			if normalizedRole == "" || normalizedRole == "public" {
				continue
			}
			seen[normalizedRole] = struct{}{}
		}
	}

	for role := range seen {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1)`, role).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("invalid RLS role: %s", role)
		}
	}

	return nil
}

func writePostgresAwareError(c echo.Context, err error, fallback string) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": fallback,
		})
	}

	status := http.StatusBadRequest
	var message string
	var errorCode string

	switch pgErr.Code {
	case "42P01":
		message = "The referenced table or sequence does not exist in this database."
		errorCode = "PG_UNDEFINED_RELATION"
	case "42703":
		message = "One of the referenced columns does not exist."
		errorCode = "PG_UNDEFINED_COLUMN"
	case "42883":
		message = "A function used in the expression does not exist or has mismatched parameter types."
		errorCode = "PG_UNDEFINED_FUNCTION"
	case "42601":
		message = "There is a SQL syntax error in the expression or rule provided."
		errorCode = "PG_SYNTAX_ERROR"
	case "22P02":
		message = "One of the values does not match the expected format for its data type."
		errorCode = "PG_INVALID_TEXT_REPRESENTATION"
	case "23502":
		message = "A required value (NOT NULL) is missing for a column."
		errorCode = "PG_NOT_NULL_VIOLATION"
	case "23503":
		message = "Foreign key constraint violation: the referenced record does not exist."
		errorCode = "PG_FOREIGN_KEY_VIOLATION"
	case "23505":
		message = "A record with the same unique value already exists."
		errorCode = "PG_UNIQUE_VIOLATION"
	default:
		status = http.StatusInternalServerError
		message = "Internal database processing error."
		errorCode = "PG_INTERNAL"
	}

	payload := map[string]string{
		"error":      message,
		"error_code": errorCode,
	}
	if hint := strings.TrimSpace(pgErr.Hint); hint != "" {
		payload["hint"] = hint
	}

	return c.JSON(status, payload)
}

func normalizeRLSPolicies(singleRule string, perAction map[string]string) map[string]string {
	policies := map[string]string{
		"select": "",
		"insert": "",
		"update": "",
		"delete": "",
	}

	for action, raw := range perAction {
		key := strings.ToLower(strings.TrimSpace(action))
		if _, ok := policies[key]; ok {
			policies[key] = strings.TrimSpace(raw)
		}
	}

	legacy := strings.TrimSpace(singleRule)
	if legacy != "" {
		for action, value := range policies {
			if value == "" {
				policies[action] = legacy
			}
		}
	}

	return policies
}

func normalizeRLSPolicyRoles(perAction map[string][]string) map[string][]string {
	roles := map[string][]string{
		"select": {},
		"insert": {},
		"update": {},
		"delete": {},
	}

	for action, rawRoles := range perAction {
		key := strings.ToLower(strings.TrimSpace(action))
		if _, ok := roles[key]; !ok {
			continue
		}
		seen := make(map[string]struct{}, len(rawRoles))
		normalized := make([]string, 0, len(rawRoles))
		for _, role := range rawRoles {
			candidate := strings.ToLower(strings.TrimSpace(role))
			if candidate == "" {
				continue
			}
			if candidate != "public" && !data.IsValidIdentifier(candidate) {
				continue
			}
			if _, exists := seen[candidate]; exists {
				continue
			}
			seen[candidate] = struct{}{}
			normalized = append(normalized, candidate)
		}
		roles[key] = normalized
	}

	return roles
}

func primaryRLSRule(singleRule string, policies map[string]string) string {
	if trimmed := strings.TrimSpace(singleRule); trimmed != "" {
		return trimmed
	}
	for _, action := range rlsActions {
		if candidate := strings.TrimSpace(policies[action]); candidate != "" {
			return candidate
		}
	}
	return ""
}

func makePolicyName(tableName, action string) string {
	candidate := fmt.Sprintf("policy_ozy_%s_%s", tableName, action)
	if len(candidate) <= 63 {
		return candidate
	}

	// Keep deterministic suffix while respecting identifier length.
	shortTable := tableName
	maxTable := 63 - len("policy_ozy__") - len(action) - 8
	if maxTable < 1 {
		maxTable = 1
	}
	if len(shortTable) > maxTable {
		shortTable = shortTable[:maxTable]
	}
	return fmt.Sprintf("policy_ozy_%s_%s", shortTable, action)
}

func commentSQLBlock(sql string) string {
	lines := strings.Split(strings.TrimSpace(sql), "\n")
	if len(lines) == 0 {
		return "--"
	}

	commented := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimRight(line, " \t")
		if trimmed == "" {
			commented = append(commented, "--")
			continue
		}
		commented = append(commented, "-- "+trimmed)
	}
	return strings.Join(commented, "\n")
}

func buildTableDefinitionEditorSQL(tableName, definitionSQL string) string {
	qualifiedTableName := data.QuoteIdentifier("public") + "." + data.QuoteIdentifier(tableName)
	return strings.TrimSpace(fmt.Sprintf(`-- Definition for %s
%s

-- Current data preview
SELECT * FROM %s LIMIT 200;`, qualifiedTableName, commentSQLBlock(definitionSQL), qualifiedTableName))
}

func qualifiedPublicTableName(tableName string) string {
	return data.QuoteIdentifier("public") + "." + data.QuoteIdentifier(tableName)
}

func buildRLSValidationSQL(tableName, expression string) string {
	return fmt.Sprintf("EXPLAIN SELECT 1 FROM %s WHERE (%s) LIMIT 0", qualifiedPublicTableName(tableName), expression)
}

func ensureRLSCompatibilityLayer(ctx context.Context, tx pgx.Tx) error {
	compatSQL := `
		CREATE SCHEMA IF NOT EXISTS auth;

		DO $$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
				CREATE ROLE anon NOLOGIN;
			END IF;
			IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
				CREATE ROLE authenticated NOLOGIN;
			END IF;
			IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
				CREATE ROLE service_role NOLOGIN;
			END IF;
		END
		$$;

		CREATE OR REPLACE FUNCTION auth.jwt()
		RETURNS jsonb
		LANGUAGE plpgsql
		STABLE
		AS $$
		DECLARE
			raw_claims text;
		BEGIN
			raw_claims := current_setting('request.jwt.claims', true);
			IF raw_claims IS NULL OR btrim(raw_claims) = '' THEN
				RETURN '{}'::jsonb;
			END IF;

			BEGIN
				RETURN raw_claims::jsonb;
			EXCEPTION WHEN OTHERS THEN
				RETURN '{}'::jsonb;
			END;
		END;
		$$;

		CREATE OR REPLACE FUNCTION auth.uid()
		RETURNS uuid
		LANGUAGE sql
		STABLE
		AS $$
			SELECT
			CASE
				WHEN candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
				THEN candidate::uuid
				ELSE NULL::uuid
			END
			FROM (
				SELECT COALESCE(
					NULLIF(current_setting('request.jwt.claim.sub', true), ''),
					NULLIF((auth.jwt() ->> 'sub'), '')
				) AS candidate
			) s;
		$$;

		CREATE OR REPLACE FUNCTION auth.role()
		RETURNS text
		LANGUAGE sql
		STABLE
		AS $$
			SELECT NULLIF(COALESCE(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true)), '')::text;
		$$;

		CREATE OR REPLACE FUNCTION auth.team_id()
		RETURNS uuid
		LANGUAGE sql
		STABLE
		AS $$
			SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'team_id', '')::uuid;
		$$;

		CREATE OR REPLACE FUNCTION auth.workspace_id()
		RETURNS uuid
		LANGUAGE sql
		STABLE
		AS $$
			SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'workspace_id', '')::uuid;
		$$;
	`

	_, err := tx.Exec(ctx, compatSQL)
	return err
}

func validateRLSExpression(ctx context.Context, tx pgx.Tx, tableName, expr string) error {
	expression := strings.TrimSpace(expr)
	if expression == "" {
		return fmt.Errorf("policy expression cannot be empty")
	}
	if len(expression) > 1024 {
		return fmt.Errorf("policy expression is too long")
	}

	blocked := []string{";", "--", "/*", "*/", "pg_sleep(", "set_config("}
	lower := strings.ToLower(expression)
	for _, token := range blocked {
		if strings.Contains(lower, token) {
			return fmt.Errorf("policy expression contains disallowed token: %s", token)
		}
	}

	// Ask Postgres to validate expression syntax and referenced columns.
	// #nosec G201
	validateSQL := buildRLSValidationSQL(tableName, expression)
	_, err := tx.Exec(ctx, validateSQL)
	if err == nil {
		return nil
	}

	// Accept auth helper expressions even when auth.uid()/auth.jwt() are not installed
	// in the target database yet (common in fresh environments).
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "42883" {
		lowerErr := strings.ToLower(pgErr.Message)
		if strings.Contains(lowerErr, "auth.uid") || strings.Contains(lowerErr, "auth.jwt") {
			return nil
		}
	}

	return err
}

func (h *Handler) loadCollectionSchemaFromDatabase(ctx context.Context, tableName string) ([]data.FieldSchema, error) {
	if !data.IsValidIdentifier(tableName) {
		return nil, fmt.Errorf("invalid table name: %s", tableName)
	}

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT column_name, data_type, udt_name, is_nullable
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = $1
		ORDER BY ordinal_position
	`, tableName)
	if err != nil {
		return nil, fmt.Errorf("failed to query table schema: %w", err)
	}
	defer rows.Close()

	found := false
	schema := make([]data.FieldSchema, 0)
	for rows.Next() {
		found = true
		var colName, dataType, udtName, isNullable string
		if err := rows.Scan(&colName, &dataType, &udtName, &isNullable); err != nil {
			return nil, fmt.Errorf("failed to scan column schema: %w", err)
		}

		schema = append(schema, data.FieldSchema{
			Name:     colName,
			Type:     data.NormalizePostgresTypeToOzy(dataType, udtName),
			Required: isNullable == "NO",
		})
	}

	if rows.Err() != nil {
		return nil, fmt.Errorf("failed to read table schema: %w", rows.Err())
	}
	if !found {
		return nil, fmt.Errorf("table not found: %s", tableName)
	}

	return schema, nil
}

type tableCapabilities struct {
	HasID            bool
	HasPrimaryID     bool
	PrimaryKeyColumn string
	HasCreatedAt     bool
	HasUpdatedAt     bool
	HasDeletedAt     bool
	RlsEnabled       bool
}

func (h *Handler) loadCollectionTableCapabilities(ctx context.Context) (map[string]tableCapabilities, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT 
			c.table_name,
			BOOL_OR(c.column_name = 'id') AS has_id,
			BOOL_OR(c.column_name = 'created_at') AS has_created_at,
			BOOL_OR(c.column_name = 'updated_at') AS has_updated_at,
			BOOL_OR(c.column_name = 'deleted_at') AS has_deleted_at,
			COALESCE((
				SELECT COUNT(*)
				FROM information_schema.table_constraints tc
				JOIN information_schema.key_column_usage kcu
				  ON tc.constraint_name = kcu.constraint_name
				 AND tc.table_schema = kcu.table_schema
				 AND tc.table_name = kcu.table_name
				WHERE tc.table_name = c.table_name
				  AND tc.table_schema = c.table_schema
				  AND tc.constraint_type = 'PRIMARY KEY'
			), 0) AS primary_key_column_count,
			(
				SELECT kcu.column_name 
				FROM information_schema.table_constraints tc
				JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
				WHERE tc.table_name = c.table_name
				  AND tc.table_schema = c.table_schema
				  AND tc.constraint_type = 'PRIMARY KEY'
				ORDER BY kcu.ordinal_position
				LIMIT 1
			) AS primary_id_column,
			EXISTS (
				SELECT 1 FROM pg_class cls
				JOIN pg_namespace ns ON cls.relnamespace = ns.oid
				WHERE cls.relname = c.table_name
				  AND ns.nspname = c.table_schema
				  AND cls.relrowsecurity = true
			) AS rls_enabled
		FROM information_schema.columns c
		WHERE c.table_schema = 'public'
		GROUP BY c.table_name, c.table_schema
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	capabilities := make(map[string]tableCapabilities)
	for rows.Next() {
		var tableName string
		var cap tableCapabilities
		var pkCount int
		var pkCol *string
		if err := rows.Scan(&tableName, &cap.HasID, &cap.HasCreatedAt, &cap.HasUpdatedAt, &cap.HasDeletedAt, &pkCount, &pkCol, &cap.RlsEnabled); err == nil {
			cap.HasPrimaryID = pkCount == 1
			if cap.HasPrimaryID && pkCol != nil {
				cap.PrimaryKeyColumn = *pkCol
			}
			capabilities[tableName] = cap
		}
	}
	return capabilities, nil
}

func applyCollectionCapabilities(col Collection, capabilities map[string]tableCapabilities) Collection {
	if cap, ok := capabilities[col.Name]; ok {
		col.HasID = cap.HasID
		col.HasPrimaryID = cap.HasPrimaryID
		col.PrimaryKeyColumn = cap.PrimaryKeyColumn
		col.HasCreatedAt = cap.HasCreatedAt
		col.HasUpdatedAt = cap.HasUpdatedAt
		col.HasDeletedAt = cap.HasDeletedAt
		col.RlsEnabled = cap.RlsEnabled
	}
	return col
}

func (h *Handler) upsertCollectionMetadataForTable(ctx context.Context, tableName, workspaceID string) error {
	schema, err := h.loadCollectionSchemaFromDatabase(ctx, tableName)
	if err != nil {
		return err
	}

	schemaJSONBytes, err := json.Marshal(schema)
	if err != nil {
		return fmt.Errorf("failed to encode schema metadata: %w", err)
	}
	schemaJSON := string(schemaJSONBytes)

	var workspace any
	if strings.TrimSpace(workspaceID) != "" {
		workspace = workspaceID
	}

	_, err = h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_collections (
			name, display_name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, workspace_id, updated_at
		)
		VALUES ($1, $2, $3, 'auth', 'admin', FALSE, '', FALSE, $4, NOW())
		ON CONFLICT (name) DO UPDATE SET
			display_name = COALESCE(NULLIF(_v_collections.display_name, ''), EXCLUDED.display_name),
			schema_def = EXCLUDED.schema_def,
			workspace_id = COALESCE(_v_collections.workspace_id, EXCLUDED.workspace_id),
			updated_at = NOW()
	`, tableName, tableName, schemaJSON, workspace)
	if err == nil {
		return nil
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "42703" {
		_, err = h.DB.Pool.Exec(ctx, `
			INSERT INTO _v_collections (
				name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, workspace_id, updated_at
			)
			VALUES ($1, $2, 'auth', 'admin', FALSE, '', FALSE, $3, NOW())
			ON CONFLICT (name) DO UPDATE SET
				schema_def = EXCLUDED.schema_def,
				workspace_id = COALESCE(_v_collections.workspace_id, EXCLUDED.workspace_id),
				updated_at = NOW()
		`, tableName, schemaJSON, workspace)
	}
	if err != nil {
		return fmt.Errorf("failed to upsert collection metadata for %s: %w", tableName, err)
	}
	return nil
}

func (h *Handler) renameCollectionMetadataForTable(ctx context.Context, oldTableName, newTableName, workspaceID string) error {
	if oldTableName == newTableName {
		return h.upsertCollectionMetadataForTable(ctx, newTableName, workspaceID)
	}

	schema, err := h.loadCollectionSchemaFromDatabase(ctx, newTableName)
	if err != nil {
		return err
	}

	schemaJSONBytes, err := json.Marshal(schema)
	if err != nil {
		return fmt.Errorf("failed to encode renamed schema metadata: %w", err)
	}
	schemaJSON := string(schemaJSONBytes)

	var workspace any
	if strings.TrimSpace(workspaceID) != "" {
		workspace = workspaceID
	}

	tag, err := h.DB.Pool.Exec(ctx, `
		UPDATE _v_collections
		SET name = $2,
			display_name = CASE
				WHEN COALESCE(display_name, '') = '' OR display_name = name THEN $2
				ELSE display_name
			END,
			schema_def = $3,
			workspace_id = COALESCE(workspace_id, $4::uuid),
			updated_at = NOW()
		WHERE name = $1
	`, oldTableName, newTableName, schemaJSON, workspace)
	if err == nil && tag.RowsAffected() > 0 {
		return nil
	}

	var pgErr *pgconn.PgError
	if err != nil && (!errors.As(err, &pgErr) || pgErr.Code != "42703") {
		return fmt.Errorf("failed to rename collection metadata from %s to %s: %w", oldTableName, newTableName, err)
	}

	if errors.As(err, &pgErr) && pgErr.Code == "42703" {
		tag, err = h.DB.Pool.Exec(ctx, `
			UPDATE _v_collections
			SET name = $2,
				schema_def = $3,
				workspace_id = COALESCE(workspace_id, $4::uuid),
				updated_at = NOW()
			WHERE name = $1
		`, oldTableName, newTableName, schemaJSON, workspace)
		if err != nil {
			return fmt.Errorf("failed to rename legacy collection metadata from %s to %s: %w", oldTableName, newTableName, err)
		}
		if tag.RowsAffected() > 0 {
			return nil
		}
	}

	return h.upsertCollectionMetadataForTable(ctx, newTableName, workspaceID)
}

func (h *Handler) deleteCollectionMetadataForTable(ctx context.Context, tableName string) error {
	if !data.IsValidIdentifier(tableName) {
		return nil
	}
	if _, err := h.DB.Pool.Exec(ctx, "DELETE FROM _v_collections WHERE name = $1", tableName); err != nil {
		return fmt.Errorf("failed to delete collection metadata for %s: %w", tableName, err)
	}
	return nil
}

// CreateCollection handles POST /api/collections
func (h *Handler) CreateCollection(c echo.Context) error {
	var req CreateCollectionRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request body",
		})
	}

	// Validate request
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name is required",
		})
	}
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.DisplayName == "" {
		req.DisplayName = req.Name
	}

	if len(req.Schema) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Schema is required and must have at least one field",
		})
	}

	hasPrimaryKey := false
	for _, field := range req.Schema {
		if field.IsPrimary {
			hasPrimaryKey = true
			break
		}
	}
	if !hasPrimaryKey {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Table must have at least one column marked as Primary Key (PK)",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	// Build the CREATE TABLE SQL
	createSQL, err := data.BuildCreateTableSQL(req.Name, req.Schema)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	// Start transaction
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to start transaction",
		})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Execute CREATE TABLE
	if _, err := tx.Exec(ctx, createSQL); err != nil {
		return writePostgresAwareError(c, err, "Could not create table. Check columns, defaults, and primary keys.")
	}

	// Attach Realtime Trigger IF ENABLED
	var triggerSQL string
	if req.RealtimeEnabled {
		triggerSQL = fmt.Sprintf(`
			CREATE TRIGGER tr_notify_%s
			AFTER INSERT OR UPDATE OR DELETE ON %s
			FOR EACH ROW EXECUTE FUNCTION notify_event();
		`, req.Name, req.Name)

		if _, err := tx.Exec(ctx, triggerSQL); err != nil {
			return writePostgresAwareError(c, err, "Could not attach realtime trigger.")
		}
	}

	// Native Postgres RLS Enforcement
	if req.RlsEnabled {
		if err := validateRLSPolicyActions(req.RlsPolicies); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error":      err.Error(),
				"error_code": "RLS_INVALID_ACTION",
			})
		}
		if err := validateRLSPolicyRoles(req.RlsRoles); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error":      err.Error(),
				"error_code": "RLS_INVALID_ROLE",
			})
		}

		if err := ensureRLSCompatibilityLayer(ctx, tx); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to initialize RLS compatibility layer: " + err.Error(),
			})
		}
		if err := ensureRLSPolicyRolesExist(ctx, tx, req.RlsRoles); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error":      err.Error(),
				"error_code": "RLS_INVALID_ROLE",
			})
		}

		if err := h.DB.EnableRLS(ctx, tx, req.Name); err != nil {
			return writePostgresAwareError(c, err, "Could not enable RLS on table.")
		}
		if err := h.DB.SetRLSForce(ctx, tx, req.Name, req.RlsForce); err != nil {
			return writePostgresAwareError(c, err, "Could not apply FORCE RLS.")
		}

		policies := normalizeRLSPolicies(req.RlsRule, req.RlsPolicies)
		rolesByAction := normalizeRLSPolicyRoles(req.RlsRoles)
		for action, expression := range policies {
			if strings.TrimSpace(expression) == "" {
				continue
			}
			if err := validateRLSExpression(ctx, tx, req.Name, expression); err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) {
					if pgErr.Code == "42703" {
						return c.JSON(http.StatusBadRequest, map[string]string{
							"error":      fmt.Sprintf("Invalid RLS %s policy: one or more referenced columns do not exist", action),
							"error_code": "RLS_INVALID_COLUMN",
						})
					}
					if pgErr.Code == "42601" || pgErr.Code == "42883" {
						return c.JSON(http.StatusBadRequest, map[string]string{
							"error":      fmt.Sprintf("Invalid RLS %s policy expression: %s", action, pgErr.Message),
							"error_code": "RLS_INVALID_EXPRESSION",
						})
					}
				}
				return c.JSON(http.StatusBadRequest, map[string]string{
					"error":      fmt.Sprintf("Invalid RLS %s policy expression", action),
					"error_code": "RLS_INVALID_EXPRESSION",
				})
			}

			policyName := makePolicyName(req.Name, action)
			_, _ = tx.Exec(ctx, fmt.Sprintf(
				"DROP POLICY IF EXISTS %s ON %s",
				data.QuoteIdentifier(policyName),
				data.QuoteIdentifier(req.Name),
			))
			if err := h.DB.CreatePolicyForAction(ctx, tx, req.Name, policyName, action, expression, rolesByAction[action]); err != nil {
				return writePostgresAwareError(c, err, "Could not create RLS policy.")
			}
		}

		if strings.TrimSpace(req.RlsRule) == "" {
			req.RlsRule = policies["select"]
		}
	}

	// Set defaults if empty
	if req.ListRule == "" {
		req.ListRule = "auth"
	}
	if req.CreateRule == "" {
		req.CreateRule = "admin"
	}

	// Set Workspace from Context if missing
	if req.WorkspaceID == "" {
		if wsID, ok := c.Get("workspace_id").(string); ok {
			req.WorkspaceID = wsID
		}
	}

	// Store collection metadata
	schemaJSONBytes, _ := json.Marshal(req.Schema)
	schemaJSON := string(schemaJSONBytes)
	var workspaceID any
	if strings.TrimSpace(req.WorkspaceID) != "" {
		workspaceID = req.WorkspaceID
	}
	var collection Collection
	err = tx.QueryRow(ctx, `
		INSERT INTO _v_collections (name, display_name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, workspace_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, name, COALESCE(display_name, name), list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, COALESCE(workspace_id::text, ''), created_at, updated_at
	`, req.Name, req.DisplayName, schemaJSON, req.ListRule, req.CreateRule, req.RlsEnabled, req.RlsRule, req.RealtimeEnabled, workspaceID).Scan(
		&collection.ID, &collection.Name, &collection.DisplayName, &collection.ListRule, &collection.CreateRule,
		&collection.RlsEnabled, &collection.RlsRule, &collection.RealtimeEnabled, &collection.WorkspaceID, &collection.CreatedAt, &collection.UpdatedAt,
	)

	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42703" {
			// Backward compatibility for deployments where display_name column is not yet present.
			err = tx.QueryRow(ctx, `
				INSERT INTO _v_collections (name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, workspace_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				RETURNING id, name, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, COALESCE(workspace_id::text, ''), created_at, updated_at
			`, req.Name, schemaJSON, req.ListRule, req.CreateRule, req.RlsEnabled, req.RlsRule, req.RealtimeEnabled, workspaceID).Scan(
				&collection.ID, &collection.Name, &collection.ListRule, &collection.CreateRule,
				&collection.RlsEnabled, &collection.RlsRule, &collection.RealtimeEnabled, &collection.WorkspaceID, &collection.CreatedAt, &collection.UpdatedAt,
			)
			collection.DisplayName = req.DisplayName
		}
	}

	if err != nil {
		return writePostgresAwareError(c, err, "Could not save table metadata.")
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to commit transaction",
		})
	}

	// Record migration
	fullMigrationSQL := createSQL
	if triggerSQL != "" {
		fullMigrationSQL += "\n\n" + triggerSQL
	}
	description := fmt.Sprintf("create_collection_%s", req.Name)
	if _, err := h.Migrations.CreateMigration(description, fullMigrationSQL); err != nil {
		log.Printf("Warning: Failed to record migration: %v", err)
	}

	searchIndexSQL := data.BuildRecordSearchIndexSQL(req.Name, collectionRequestColumnTypes(req.Schema))
	if searchIndexSQL != "" {
		if _, err := h.DB.Pool.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS pg_trgm"); err != nil {
			log.Printf("warning: failed to enable pg_trgm for %s search index: %v", req.Name, err)
		} else if _, err := h.DB.Pool.Exec(ctx, searchIndexSQL); err != nil {
			log.Printf("warning: failed to create search index for %s: %v", req.Name, err)
		}
	}

	if persistedSchema, schemaErr := h.loadCollectionSchemaFromDatabase(ctx, req.Name); schemaErr == nil {
		collection.Schema = persistedSchema
	} else {
		collection.Schema = req.Schema
	}
	if capabilities, capErr := h.loadCollectionTableCapabilities(ctx); capErr == nil {
		collection = applyCollectionCapabilities(collection, capabilities)
	}
	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.JSON(http.StatusCreated, collection)
}

// DeleteCollection handles DELETE /api/collections/:name
func (h *Handler) DeleteCollection(c echo.Context) error {
	name := c.Param("name")
	if name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Name is required"})
	}

	if !data.IsValidIdentifier(name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid collection name"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// Start transaction
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1. Drop table
	if _, err := tx.Exec(ctx, fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE", name)); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// 2. Remove metadata
	if _, err := tx.Exec(ctx, "DELETE FROM _v_collections WHERE name = $1", name); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// Record migration
	dropSQL := fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE;", name)
	description := fmt.Sprintf("delete_collection_%s", name)
	if _, err := h.Migrations.CreateMigration(description, dropSQL); err != nil {
		log.Printf("Warning: Failed to record migration: %v", err)
	}

	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.NoContent(http.StatusNoContent)
}

// DuplicateCollection handles POST /api/collections/:name/duplicate
func (h *Handler) DuplicateCollection(c echo.Context) error {
	sourceName := c.Param("name")
	if !data.IsValidIdentifier(sourceName) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid source collection name"})
	}

	var req DuplicateCollectionRequest
	if err := c.Bind(&req); err != nil && err != io.EOF {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	targetName := strings.TrimSpace(req.Name)
	if !data.IsValidIdentifier(targetName) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid target collection name"})
	}
	if targetName == sourceName {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Target collection name must be different"})
	}

	copyData := true
	if req.CopyData != nil {
		copyData = *req.CopyData
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	createSQL := fmt.Sprintf(
		"CREATE TABLE %s (LIKE %s INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)",
		data.QuoteIdentifier(targetName),
		data.QuoteIdentifier(sourceName),
	)
	if _, err := tx.Exec(ctx, createSQL); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	fullSQL := createSQL
	if copyData {
		copySQL := fmt.Sprintf(
			"INSERT INTO %s SELECT * FROM %s",
			data.QuoteIdentifier(targetName),
			data.QuoteIdentifier(sourceName),
		)
		if _, err := tx.Exec(ctx, copySQL); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		fullSQL += ";\n" + copySQL
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	workspaceID, _ := c.Get("workspace_id").(string)
	if err := h.upsertCollectionMetadataForTable(ctx, targetName, workspaceID); err != nil {
		log.Printf("warning: failed to sync duplicated collection metadata for %s: %v", targetName, err)
	}

	var sourceDisplayName string
	var sourceRealtimeEnabled bool
	if err := h.DB.Pool.QueryRow(ctx, "SELECT COALESCE(display_name, name), realtime_enabled FROM _v_collections WHERE name = $1", sourceName).Scan(&sourceDisplayName, &sourceRealtimeEnabled); err == nil {
		displayName := targetName
		if strings.TrimSpace(sourceDisplayName) != "" {
			displayName = fmt.Sprintf("%s copy", sourceDisplayName)
		}
		if _, err := h.DB.Pool.Exec(ctx, "UPDATE _v_collections SET display_name = $2, realtime_enabled = $3 WHERE name = $1", targetName, displayName, sourceRealtimeEnabled); err != nil {
			log.Printf("warning: failed to update duplicated collection display metadata for %s: %v", targetName, err)
		}
	}

	description := fmt.Sprintf("duplicate_collection_%s_to_%s", sourceName, targetName)
	if _, err := h.Migrations.CreateMigration(description, fullSQL); err != nil {
		log.Printf("Warning: Failed to record migration: %v", err)
	}

	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.JSON(http.StatusCreated, map[string]any{
		"name":      targetName,
		"copy_data": copyData,
	})
}

// RenameCollection handles PATCH /api/collections/:name/rename
func (h *Handler) RenameCollection(c echo.Context) error {
	sourceName := c.Param("name")
	if !data.IsValidIdentifier(sourceName) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid source collection name"})
	}

	var req RenameCollectionRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	targetName := strings.TrimSpace(req.NextName)
	if !data.IsValidIdentifier(targetName) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid target collection name"})
	}
	if targetName == sourceName {
		return c.JSON(http.StatusOK, map[string]any{"name": sourceName})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var realtimeEnabled bool
	if err := tx.QueryRow(ctx, "SELECT COALESCE(realtime_enabled, FALSE) FROM _v_collections WHERE name = $1", sourceName).Scan(&realtimeEnabled); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load collection metadata: " + err.Error()})
	}

	renameSQL := fmt.Sprintf(
		"ALTER TABLE %s RENAME TO %s",
		data.QuoteIdentifier(sourceName),
		data.QuoteIdentifier(targetName),
	)
	if _, err := tx.Exec(ctx, renameSQL); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	fullSQL := renameSQL
	if realtimeEnabled {
		oldTriggerName := fmt.Sprintf("tr_notify_%s", sourceName)
		newTriggerName := fmt.Sprintf("tr_notify_%s", targetName)

		var hasTrigger bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM pg_trigger t
				JOIN pg_class c ON c.oid = t.tgrelid
				JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE n.nspname = 'public'
				  AND c.relname = $1
				  AND t.tgname = $2
				  AND NOT t.tgisinternal
			)
		`, targetName, oldTriggerName).Scan(&hasTrigger); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to inspect realtime trigger: " + err.Error()})
		}

		if hasTrigger {
			renameTriggerSQL := fmt.Sprintf(
				"ALTER TRIGGER %s ON %s RENAME TO %s",
				data.QuoteIdentifier(oldTriggerName),
				data.QuoteIdentifier(targetName),
				data.QuoteIdentifier(newTriggerName),
			)
			if _, err := tx.Exec(ctx, renameTriggerSQL); err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to rename realtime trigger: " + err.Error()})
			}
			fullSQL += ";\n" + renameTriggerSQL
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	workspaceID, _ := c.Get("workspace_id").(string)
	if err := h.renameCollectionMetadataForTable(ctx, sourceName, targetName, workspaceID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to sync collection metadata: " + err.Error()})
	}

	description := fmt.Sprintf("rename_collection_%s_to_%s", sourceName, targetName)
	if _, err := h.Migrations.CreateMigration(description, fullSQL+";"); err != nil {
		log.Printf("Warning: Failed to record migration: %v", err)
	}

	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.JSON(http.StatusOK, map[string]any{"name": targetName})
}

// UpdateCollectionRules handles PATCH /api/collections/rules
func (h *Handler) UpdateCollectionRules(c echo.Context) error {
	var req struct {
		Name       string  `json:"name"`
		ListRule   *string `json:"list_rule,omitempty"`
		CreateRule *string `json:"create_rule,omitempty"`
		UpdateRule *string `json:"update_rule,omitempty"`
		DeleteRule *string `json:"delete_rule,omitempty"`
	}

	if err := c.Bind(&req); err != nil {
		return err
	}

	query := "UPDATE _v_collections SET updated_at = NOW()"
	args := []any{req.Name}
	argIdx := 2

	if req.ListRule != nil {
		query += fmt.Sprintf(", list_rule = $%d", argIdx)
		args = append(args, *req.ListRule)
		argIdx++
	}
	if req.CreateRule != nil {
		query += fmt.Sprintf(", create_rule = $%d", argIdx)
		args = append(args, *req.CreateRule)
		argIdx++
	}
	if req.UpdateRule != nil {
		query += fmt.Sprintf(", update_rule = $%d", argIdx)
		args = append(args, *req.UpdateRule)
		argIdx++
	}
	if req.DeleteRule != nil {
		query += fmt.Sprintf(", delete_rule = $%d", argIdx)
		args = append(args, *req.DeleteRule)
	}

	query += " WHERE name = $1"

	_, err := h.DB.Pool.Exec(c.Request().Context(), query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "updated"})
}

// UpdateRealtimeToggle handles PATCH /api/collections/realtime
func (h *Handler) UpdateRealtimeToggle(c echo.Context) error {
	var req struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	if err := c.Bind(&req); err != nil {
		return err
	}

	if !data.IsValidIdentifier(req.Name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid collection name"})
	}

	ctx := c.Request().Context()
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1. Update Metadata
	_, err = tx.Exec(ctx, "UPDATE _v_collections SET realtime_enabled = $1 WHERE name = $2", req.Enabled, req.Name)
	if err != nil {
		return err
	}

	// 2. Manage Trigger
	var triggerSQL string
	if req.Enabled {
		triggerSQL = fmt.Sprintf(`
			CREATE TRIGGER tr_notify_%s
			AFTER INSERT OR UPDATE OR DELETE ON %s
			FOR EACH ROW EXECUTE FUNCTION notify_event();
		`, req.Name, req.Name)
	} else {
		triggerSQL = fmt.Sprintf("DROP TRIGGER IF EXISTS tr_notify_%s ON %s", req.Name, req.Name)
	}

	if _, err := tx.Exec(ctx, triggerSQL); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update trigger: " + err.Error()})
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "updated", "realtime_enabled": fmt.Sprintf("%v", req.Enabled)})
}

// ListCollections handles GET /api/collections
func (h *Handler) ListCollections(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// Fetch all tables from information_schema
	tables, err := h.DB.ListTables(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch tables: " + err.Error(),
		})
	}

	// Fetch metadata from _v_collections scoped to workspace
	workspaceID, _ := c.Get("workspace_id").(string)
	log.Printf("[DEBUG-ListCollections] tables found=%v (count=%d), workspaceID=%s", tables, len(tables), workspaceID)

	// Fetch metadata for ALL collections to correctly identify and hide tables from other workspaces
	query := "SELECT name, COALESCE(display_name, name), schema_def, list_rule, create_rule, rls_enabled, rls_rule, created_at, updated_at, realtime_enabled, workspace_id FROM _v_collections"
	usesDisplayName := true
	rows, err := h.DB.Pool.Query(ctx, query)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42703" {
			// Backward compatibility for deployments where display_name column is not yet present.
			usesDisplayName = false
			rows, err = h.DB.Pool.Query(ctx, "SELECT name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, created_at, updated_at, realtime_enabled, workspace_id FROM _v_collections")
		}
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch collection metadata: " + err.Error(),
		})
	}

	metaMap := make(map[string]Collection)
	defer rows.Close()
	for rows.Next() {
		var col Collection
		var schemaJSON []byte
		var wsID *string
		var scanErr error
		if usesDisplayName {
			scanErr = rows.Scan(&col.Name, &col.DisplayName, &schemaJSON, &col.ListRule, &col.CreateRule, &col.RlsEnabled, &col.RlsRule, &col.CreatedAt, &col.UpdatedAt, &col.RealtimeEnabled, &wsID)
		} else {
			scanErr = rows.Scan(&col.Name, &schemaJSON, &col.ListRule, &col.CreateRule, &col.RlsEnabled, &col.RlsRule, &col.CreatedAt, &col.UpdatedAt, &col.RealtimeEnabled, &wsID)
			col.DisplayName = col.Name
		}
		if scanErr == nil {
			if wsID != nil {
				col.WorkspaceID = *wsID
			}
			if err := json.Unmarshal(schemaJSON, &col.Schema); err == nil {
				metaMap[col.Name] = col
			}
		}
	}

	capabilities, err := h.loadCollectionTableCapabilities(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to inspect table capabilities: " + err.Error(),
		})
	}

	// Combine information
	result := make([]Collection, 0, len(tables))
	for _, tableName := range tables {
		// Define system tables prefixes
		lowerName := strings.ToLower(tableName)
		isSystem := strings.HasPrefix(lowerName, "_v_") || strings.HasPrefix(lowerName, "_ozy_")

		if meta, ok := metaMap[tableName]; ok {
			// Managed table:
			if workspaceID != "" {
				// We are in a specific workspace context.
				if meta.WorkspaceID != "" && meta.WorkspaceID != workspaceID {
					// Table belongs to another specific workspace
					// Exception: Always show internal system tables to admins
					if !isSystem {
						continue
					}
				}
			}

			meta.IsSystem = isSystem
			result = append(result, applyCollectionCapabilities(meta, capabilities))
		} else {
			// Unmanaged table (e.g. created via MCP, raw SQL, or external migrations):
			var colSchema []data.FieldSchema
			if !isSystem {
				colSchema, _ = h.DB.GetTableSchema(ctx, tableName)
			}
			col := Collection{
				Name:        tableName,
				DisplayName: tableName,
				IsSystem:    isSystem,
				ListRule:    "public",
				CreateRule:  "admin",
				Schema:      colSchema,
				WorkspaceID: workspaceID,
			}
			result = append(result, applyCollectionCapabilities(col, capabilities))
		}

	}

	if result == nil {
		result = []Collection{}
	}

	return c.JSON(http.StatusOK, result)
}

// GetTableSchema handles GET /api/schema/:name
func (h *Handler) GetTableSchema(c echo.Context) error {
	tableName := c.Param("name")
	if tableName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Table name is required",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	schema, err := h.DB.GetTableSchema(ctx, tableName)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": err.Error(),
		})
	}

	return c.JSON(http.StatusOK, schema)
}

// GetTableDefinition handles GET /api/schema/:name/definition
func (h *Handler) GetTableDefinition(c echo.Context) error {
	tableName := c.Param("name")
	if tableName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Table name is required",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	definitionSQL, err := h.DB.GetTableDefinitionSQL(ctx, tableName)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": err.Error(),
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"table_name":     tableName,
		"definition_sql": definitionSQL,
		"editor_sql":     buildTableDefinitionEditorSQL(tableName, definitionSQL),
	})
}

// ExportTypeScriptTypes handles GET /api/project/schema/types
func (h *Handler) ExportTypeScriptTypes(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT table_name, column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name NOT LIKE '_v_%'
		  AND table_name NOT LIKE '_ozy_%'
		ORDER BY table_name, ordinal_position
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type colDef struct {
		name     string
		dataType string
		nullable bool
	}
	tables := make(map[string][]colDef)

	for rows.Next() {
		var tableName, colName, dataType, isNullable string
		if err := rows.Scan(&tableName, &colName, &dataType, &isNullable); err != nil {
			continue
		}
		tables[tableName] = append(tables[tableName], colDef{
			name:     colName,
			dataType: dataType,
			nullable: isNullable == "YES",
		})
	}

	var sb strings.Builder
	sb.WriteString("// Auto-generated by OzyBase Core TypeGenerator\n")
	sb.WriteString("// Generated: " + time.Now().UTC().Format(time.RFC3339) + "\n\n")

	for tableName, cols := range tables {
		structName := strings.Title(tableName)
		sb.WriteString(fmt.Sprintf("export interface %s {\n", structName))
		for _, col := range cols {
			tsType := "string"
			switch strings.ToLower(col.dataType) {
			case "integer", "bigint", "smallint", "numeric", "real", "double precision":
				tsType = "number"
			case "boolean":
				tsType = "boolean"
			case "json", "jsonb":
				tsType = "Record<string, any>"
			case "array":
				tsType = "any[]"
			}
			opt := ""
			if col.nullable {
				opt = "?"
			}
			sb.WriteString(fmt.Sprintf("  %s%s: %s;\n", col.name, opt, tsType))
		}
		sb.WriteString("}\n\n")
	}

	c.Response().Header().Set(echo.HeaderContentDisposition, "attachment; filename=ozybase_types.ts")
	return c.Blob(http.StatusOK, "text/typescript", []byte(sb.String()))
}

// ListSchemas handles GET /api/schemas
func (h *Handler) ListSchemas(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	schemas, err := h.DB.ListSchemas(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to list schemas: " + err.Error(),
		})
	}

	return c.JSON(http.StatusOK, schemas)
}

// AddColumn handles POST /api/tables/:name/columns
func (h *Handler) AddColumn(c echo.Context) error {
	tableName := c.Param("name")
	var field data.FieldSchema
	if err := c.Bind(&field); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid body"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	sql, err := h.DB.AddColumn(ctx, tableName, field)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Record migration
	description := fmt.Sprintf("add_column_%s_to_%s", field.Name, tableName)
	if _, err := h.Migrations.CreateMigration(description, sql); err != nil {
		log.Printf("Warning: Failed to record migration: %v", err)
	}

	workspaceID, _ := c.Get("workspace_id").(string)
	if err := h.upsertCollectionMetadataForTable(ctx, tableName, workspaceID); err != nil {
		log.Printf("warning: failed to sync collection metadata after add column on %s: %v", tableName, err)
	}

	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.JSON(http.StatusCreated, field)
}

// UpdateColumn handles PATCH /api/tables/:name/columns/:col
func (h *Handler) UpdateColumn(c echo.Context) error {
	tableName := c.Param("name")
	columnName := c.Param("col")
	var req UpdateColumnRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid body"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	sql, err := h.DB.UpdateColumn(ctx, tableName, columnName, data.UpdateColumnOptions{
		NextName:    req.NextName,
		Type:        req.Type,
		Required:    req.Required,
		DefaultMode: req.DefaultMode,
		Default:     req.DefaultValue,
	})
	if err != nil {
		return writePostgresAwareError(c, err, "Could not update column")
	}

	description := fmt.Sprintf("update_column_%s_in_%s", columnName, tableName)
	if _, err := h.Migrations.CreateMigration(description, sql); err != nil {
		log.Printf("Warning: Failed to record migration: %v", err)
	}

	workspaceID, _ := c.Get("workspace_id").(string)
	if err := h.upsertCollectionMetadataForTable(ctx, tableName, workspaceID); err != nil {
		log.Printf("warning: failed to sync collection metadata after update column on %s: %v", tableName, err)
	}

	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.JSON(http.StatusOK, map[string]any{
		"name":         columnName,
		"updated_name": strings.TrimSpace(req.NextName),
	})
}

// UpdateTablePrimaryKey handles PATCH /api/tables/:name/primary-key
func (h *Handler) UpdateTablePrimaryKey(c echo.Context) error {
	tableName := c.Param("name")
	if !data.IsValidIdentifier(tableName) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid table name"})
	}

	var req UpdatePrimaryKeyRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid body"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	sql, err := h.DB.SetTablePrimaryKey(ctx, tableName, req.Columns)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	if strings.TrimSpace(sql) != "" {
		description := fmt.Sprintf("set_primary_key_%s", tableName)
		if _, err := h.Migrations.CreateMigration(description, sql); err != nil {
			log.Printf("Warning: Failed to record migration: %v", err)
		}
	}

	workspaceID, _ := c.Get("workspace_id").(string)
	if err := h.upsertCollectionMetadataForTable(ctx, tableName, workspaceID); err != nil {
		log.Printf("warning: failed to sync collection metadata after primary key update on %s: %v", tableName, err)
	}

	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.JSON(http.StatusOK, map[string]any{
		"table":   tableName,
		"columns": req.Columns,
		"status":  "updated",
	})
}

// DeleteColumn handles DELETE /api/tables/:name/columns/:col
func (h *Handler) DeleteColumn(c echo.Context) error {
	tableName := c.Param("name")
	columnName := c.Param("col")

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	sql, err := h.DB.DeleteColumn(ctx, tableName, columnName)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Record migration
	description := fmt.Sprintf("delete_column_%s_from_%s", columnName, tableName)
	if _, err := h.Migrations.CreateMigration(description, sql); err != nil {
		log.Printf("Warning: Failed to record migration: %v", err)
	}

	workspaceID, _ := c.Get("workspace_id").(string)
	if err := h.upsertCollectionMetadataForTable(ctx, tableName, workspaceID); err != nil {
		log.Printf("warning: failed to sync collection metadata after delete column on %s: %v", tableName, err)
	}

	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.NoContent(http.StatusNoContent)
}

// GetVisualizeSchema handles GET /api/collections/visualize
func (h *Handler) GetVisualizeSchema(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	schema, err := h.DB.GetDatabaseSchema(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch database schema: " + err.Error(),
		})
	}

	return c.JSON(http.StatusOK, schema)
}

// ProjectInfo represents the project information response
type ProjectInfo struct {
	Name              string                     `json:"name"`
	Database          string                     `json:"database"`
	APIURL            string                     `json:"api_url,omitempty"`
	AppDomain         string                     `json:"app_domain,omitempty"`
	DeployCountryCode string                     `json:"deploy_country_code,omitempty"`
	ProjectScopeMode  string                     `json:"project_scope_mode"`
	Capabilities      ProjectCapabilities        `json:"capabilities"`
	TableCount        int                        `json:"table_count"`
	UserTableCount    int                        `json:"user_table_count"`
	SystemTableCount  int                        `json:"system_table_count"`
	FunctionCount     int                        `json:"function_count"`
	UserFunctionCount int                        `json:"user_function_count"`
	SchemaCount       int                        `json:"schema_count"`
	UserSchemaCount   int                        `json:"user_schema_count"`
	DbSize            string                     `json:"db_size"`
	DbSizeBytes       int64                      `json:"db_size_bytes"`
	Version           string                     `json:"version"`
	Production        ProjectProductionReadiness `json:"production"`
	Metrics           DbMetrics                  `json:"metrics"`
	SlowQueries       []SlowQuery                `json:"slow_queries"`
}

type ProjectCapabilities struct {
	SupportsDedicatedSchema   bool `json:"supports_dedicated_schema"`
	SupportsDedicatedDatabase bool `json:"supports_dedicated_database"`
	SupportsManagedBilling    bool `json:"supports_managed_billing"`
	SupportsManagedPITR       bool `json:"supports_managed_pitr"`
	SupportsReadReplicasUI    bool `json:"supports_read_replicas_ui"`
	SupportsFailoverUI        bool `json:"supports_failover_ui"`
}

type DbMetrics struct {
	DbRequests       int       `json:"db_requests"`
	AuthRequests     int       `json:"auth_requests"`
	StorageRequests  int       `json:"storage_requests"`
	RealtimeRequests int       `json:"realtime_requests"`
	DbHistory        []int     `json:"db_history"`
	AuthHistory      []int     `json:"auth_history"`
	StorageHistory   []int     `json:"storage_history"`
	RealtimeHistory  []int     `json:"realtime_history"`
	CpuHistory       []float64 `json:"cpu_history"`
	RamHistory       []float64 `json:"ram_history"`
}

type SlowQuery struct {
	Query   string  `json:"query"`
	AvgTime float64 `json:"avg_time"` // in seconds
	Calls   int     `json:"calls"`
}

// GetProjectInfo handles GET /api/project/info
func (h *Handler) GetProjectInfo(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()
	forceRefresh := strings.EqualFold(strings.TrimSpace(c.QueryParam("refresh")), "true")
	if !forceRefresh {
		if cached, ok := h.getCachedProjectInfo(); ok {
			return c.JSON(http.StatusOK, h.applyProjectInfoAccess(cached, c))
		}
	}

	var info ProjectInfo

	// Get database name and connection info from current connection
	err := h.DB.Pool.QueryRow(ctx, `SELECT current_database()`).Scan(&info.Database)
	if err != nil {
		info.Database = "unknown"
	}

	// Set OzyBase application version
	info.Version = version.Version
	info.Production = h.runtimeProductionReadiness(ctx)
	info.ProjectScopeMode = "logical_shared_db"
	info.Capabilities = ProjectCapabilities{
		SupportsDedicatedSchema:   false,
		SupportsDedicatedDatabase: false,
		SupportsManagedBilling:    false,
		SupportsManagedPITR:       false,
		SupportsReadReplicasUI:    false,
		SupportsFailoverUI:        false,
	}

	// Get table counts aligned with active workspace and Table Editor
	workspaceID, _ := c.Get("workspace_id").(string)
	tables, err := h.DB.ListTables(ctx)
	if err == nil {
		metaRows, _ := h.DB.Pool.Query(ctx, "SELECT name, COALESCE(workspace_id::text, '') FROM _v_collections")
		metaWsMap := make(map[string]string)
		if metaRows != nil {
			for metaRows.Next() {
				var name, ws string
				if err := metaRows.Scan(&name, &ws); err == nil {
					metaWsMap[name] = ws
				}
			}
			metaRows.Close()
		}

		for _, tableName := range tables {
			lowerName := strings.ToLower(tableName)
			isSys := strings.HasPrefix(lowerName, "_v_") || strings.HasPrefix(lowerName, "_ozy_") ||
				lowerName == "migrations" || lowerName == "workspaces" || lowerName == "workspace_members" ||
				lowerName == "auth_sessions" || lowerName == "storage_buckets"

			if isSys {
				info.SystemTableCount++
				continue
			}

			if ws, ok := metaWsMap[tableName]; ok && workspaceID != "" && ws != "" && ws != workspaceID {
				continue
			}

			info.UserTableCount++
		}
		info.TableCount = info.UserTableCount
	}

	// Get total public function count (legacy metric kept for compatibility)
	err = h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM information_schema.routines
		WHERE routine_schema = 'public'
		AND routine_type = 'FUNCTION'
	`).Scan(&info.FunctionCount)
	if err != nil {
		info.FunctionCount = 0
	}

	// Get user-facing function count (hide internal helper routines)
	err = h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM information_schema.routines
		WHERE routine_schema = 'public'
		AND routine_type = 'FUNCTION'
		AND routine_name NOT LIKE '\_v\_%' ESCAPE '\'
		AND routine_name NOT LIKE '\_ozy\_%' ESCAPE '\'
	`).Scan(&info.UserFunctionCount)
	if err != nil {
		info.UserFunctionCount = 0
	}

	// Get total schema count excluding PostgreSQL internal schemas (legacy metric)
	err = h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM information_schema.schemata
		WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
	`).Scan(&info.SchemaCount)
	if err != nil {
		info.SchemaCount = 0
	}

	// Get user-facing schema count (hide default/base schemas)
	err = h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM information_schema.schemata
		WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'public', 'auth')
		  AND schema_name NOT LIKE 'pg\_%' ESCAPE '\'
		  AND schema_name NOT LIKE '\_v\_%' ESCAPE '\'
		  AND schema_name NOT LIKE '\_ozy\_%' ESCAPE '\'
	`).Scan(&info.UserSchemaCount)
	if err != nil {
		info.UserSchemaCount = 0
	}

	// Get database size
	err = h.DB.Pool.QueryRow(ctx, `SELECT pg_size_pretty(pg_database_size(current_database()))`).Scan(&info.DbSize)
	if err != nil {
		info.DbSize = "unknown"
	}
	_ = h.DB.Pool.QueryRow(ctx, `SELECT pg_database_size(current_database())`).Scan(&info.DbSizeBytes)

	// REAL METRICS FROM IN-MEMORY STORE
	h.Metrics.RLock()
	info.Metrics.DbRequests = h.Metrics.DbRequests
	info.Metrics.AuthRequests = h.Metrics.AuthRequests
	info.Metrics.StorageRequests = h.Metrics.StorageRequests

	// Helper to get last 12 points
	getLast12 := func(history []int) []int {
		res := make([]int, 12)
		historyLen := len(history)
		for i := 0; i < 12; i++ {
			idx := historyLen - 12 + i
			if idx >= 0 && idx < historyLen {
				res[i] = history[idx]
			}
		}
		return res
	}

	getLast12Float := func(history []float64) []float64 {
		res := make([]float64, 12)
		historyLen := len(history)
		for i := 0; i < 12; i++ {
			idx := historyLen - 12 + i
			if idx >= 0 && idx < historyLen {
				res[i] = history[idx]
			}
		}
		return res
	}

	info.Metrics.DbHistory = getLast12(h.Metrics.DbHistory)
	info.Metrics.AuthHistory = getLast12(h.Metrics.AuthHistory)
	info.Metrics.StorageHistory = getLast12(h.Metrics.StorageHistory)
	info.Metrics.RealtimeHistory = getLast12(h.Metrics.RealtimeHistory)
	info.Metrics.CpuHistory = getLast12Float(h.Metrics.CpuHistory)
	info.Metrics.RamHistory = getLast12Float(h.Metrics.RamHistory)
	h.Metrics.RUnlock()

	// 4. Realtime requests (active backends currently processing)
	_ = h.DB.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%'").Scan(&info.Metrics.RealtimeRequests)

	// SLOW QUERIES (Attempt to use pg_stat_statements if available, otherwise use pg_stat_activity)
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT query,
		       EXTRACT(EPOCH FROM (now() - query_start)) as duration,
		       1 as calls
		FROM pg_stat_activity
		WHERE state = 'active'
		AND query NOT LIKE '%pg_stat_activity%'
		ORDER BY duration DESC
		LIMIT 5
	`)

	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var sq SlowQuery
			if err := rows.Scan(&sq.Query, &sq.AvgTime, &sq.Calls); err == nil {
				if len(sq.Query) > 100 {
					sq.Query = sq.Query[:97] + "..."
				}
				info.SlowQueries = append(info.SlowQueries, sq)
			}
		}
	}

	if info.SlowQueries == nil {
		info.SlowQueries = []SlowQuery{}
	}

	info.Name = info.Database
	if apiURL := readEnvForProjectInfo("SITE_URL"); apiURL != "" {
		info.APIURL = strings.TrimRight(apiURL, "/")
	}
	info.AppDomain = readEnvForProjectInfo("APP_DOMAIN")
	info.DeployCountryCode = readProjectInfoCountryCode()
	if info.DeployCountryCode == "" {
		info.DeployCountryCode = h.lookupProjectInfoCountryCode(ctx, info)
	}

	h.setCachedProjectInfo(info, 5*time.Second)
	return c.JSON(http.StatusOK, info)
}

func readEnvForProjectInfo(key string) string {
	val := strings.TrimSpace(os.Getenv(key))
	if val == "" {
		return ""
	}
	if isSetPlaceholder(val, key) {
		return ""
	}
	return val
}

func isSetPlaceholder(value, key string) bool {
	v := strings.ToLower(strings.TrimSpace(value))
	k := strings.ToLower(strings.TrimSpace(key))
	return v == "set_"+k || v == "set "+k || v == "set-"+k || v == "set:"+k
}

func readProjectInfoCountryCode() string {
	for _, key := range []string{
		"DEPLOY_COUNTRY_CODE",
		"OZY_DEPLOY_COUNTRY_CODE",
		"PROJECT_COUNTRY_CODE",
	} {
		value := strings.ToUpper(strings.TrimSpace(readEnvForProjectInfo(key)))
		if len(value) == 2 {
			return value
		}
	}
	return ""
}

func (h *Handler) lookupProjectInfoCountryCode(ctx context.Context, info ProjectInfo) string {
	if h == nil || h.Geo == nil {
		return ""
	}

	host := strings.TrimSpace(info.AppDomain)
	if host == "" && strings.TrimSpace(info.APIURL) != "" {
		if parsed, err := url.Parse(info.APIURL); err == nil {
			host = parsed.Hostname()
		}
	}
	host = strings.TrimSpace(host)
	if host == "" {
		return ""
	}

	ip := resolveProjectInfoPublicIP(ctx, host)
	if ip == "" {
		return ""
	}

	geo, err := h.Geo.GetLocation(ctx, ip)
	if err != nil {
		return ""
	}

	return countryCodeFromCountryLabel(geo.Country)
}

func resolveProjectInfoPublicIP(ctx context.Context, host string) string {
	trimmed := strings.TrimSpace(host)
	if trimmed == "" {
		return ""
	}

	if parsedIP := net.ParseIP(trimmed); parsedIP != nil {
		if isPublicProjectIP(parsedIP) {
			return parsedIP.String()
		}
		return ""
	}

	lookupCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()

	ips, err := net.DefaultResolver.LookupIPAddr(lookupCtx, trimmed)
	if err != nil {
		return ""
	}

	for _, ipAddr := range ips {
		if isPublicProjectIP(ipAddr.IP) {
			return ipAddr.IP.String()
		}
	}

	return ""
}

func isPublicProjectIP(ip net.IP) bool {
	if ip == nil {
		return false
	}

	return !ip.IsLoopback() &&
		!ip.IsPrivate() &&
		!ip.IsLinkLocalMulticast() &&
		!ip.IsLinkLocalUnicast() &&
		!ip.IsMulticast() &&
		!ip.IsUnspecified()
}

func countryCodeFromCountryLabel(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	upper := strings.ToUpper(trimmed)
	if len(upper) == 2 {
		if _, err := language.ParseRegion(upper); err == nil {
			return upper
		}
	}

	normalizedTarget := normalizeGeoCountryLabel(trimmed)
	if normalizedTarget == "" {
		return ""
	}

	for first := 'A'; first <= 'Z'; first++ {
		for second := 'A'; second <= 'Z'; second++ {
			code := string([]rune{first, second})
			region, err := language.ParseRegion(code)
			if err != nil {
				continue
			}
			regionName := strings.TrimSpace(display.English.Regions().Name(region))
			if normalizeGeoCountryLabel(regionName) == normalizedTarget {
				return code
			}
		}
	}

	return ""
}

func (h *Handler) getCachedProjectInfo() (ProjectInfo, bool) {
	h.projectInfoCacheMu.RLock()
	defer h.projectInfoCacheMu.RUnlock()
	if h.projectInfoCache == nil || time.Now().After(h.projectInfoCacheUntil) {
		return ProjectInfo{}, false
	}
	return *h.projectInfoCache, true
}

func (h *Handler) setCachedProjectInfo(info ProjectInfo, ttl time.Duration) {
	h.projectInfoCacheMu.Lock()
	defer h.projectInfoCacheMu.Unlock()
	h.projectInfoCache = &info
	h.projectInfoCacheUntil = time.Now().Add(ttl)
}

func (h *Handler) applyProjectInfoAccess(info ProjectInfo, _ echo.Context) ProjectInfo {
	return info
}

func (h *Handler) getCachedHealthIssues() ([]HealthIssue, bool) {
	h.healthIssuesCacheMu.RLock()
	defer h.healthIssuesCacheMu.RUnlock()
	if h.healthIssuesCache == nil || time.Now().After(h.healthIssuesCacheUntil) {
		return nil, false
	}
	out := make([]HealthIssue, len(h.healthIssuesCache))
	copy(out, h.healthIssuesCache)
	return out, true
}

func (h *Handler) setCachedHealthIssues(issues []HealthIssue, ttl time.Duration) {
	cloned := make([]HealthIssue, len(issues))
	copy(cloned, issues)

	h.healthIssuesCacheMu.Lock()
	defer h.healthIssuesCacheMu.Unlock()
	h.healthIssuesCache = cloned
	h.healthIssuesCacheUntil = time.Now().Add(ttl)
}

func (h *Handler) invalidateProjectInfoCache() {
	h.projectInfoCacheMu.Lock()
	defer h.projectInfoCacheMu.Unlock()
	h.projectInfoCache = nil
	h.projectInfoCacheUntil = time.Time{}
}

func (h *Handler) invalidateHealthIssuesCache() {
	h.healthIssuesCacheMu.Lock()
	defer h.healthIssuesCacheMu.Unlock()
	h.healthIssuesCache = nil
	h.healthIssuesCacheUntil = time.Time{}
}

func (h *Handler) runtimeProductionReadiness(ctx context.Context) ProjectProductionReadiness {
	readiness := h.Production
	if cfg, _, err := mailer.LoadSMTPConfig(ctx, h.DB, mailer.SMTPConfigFromEnvironment()); err == nil {
		readiness.SMTPConfigured = cfg.Configured()
	}

	readiness.MVPReady =
		readiness.LaunchReady &&
			readiness.DeploymentMode == "external_postgres" &&
			readiness.SMTPConfigured

	readiness.SaaSReady =
		readiness.MVPReady &&
			readiness.PoolerConfigured &&
			readiness.StorageRuntime != "local" &&
			readiness.RealtimeRuntime != "local"

	if readiness.LaunchReady && ((readiness.Profile != "azure_cloud" && readiness.Profile != "custom") || readiness.MVPReady) {
		readiness.Status = "ready"
	} else {
		readiness.Status = "action_required"
	}

	return readiness
}

// HealthIssue represents a security or performance recommendation
type HealthIssue struct {
	Type        string `json:"type"` // "security" | "performance"
	Title       string `json:"title"`
	Description string `json:"description"`
	Fixable     bool   `json:"fixable"`
	Reviewable  bool   `json:"reviewable,omitempty"`
	ReviewKey   string `json:"review_key,omitempty"`
	ActionView  string `json:"action_view,omitempty"`
	ActionLabel string `json:"action_label,omitempty"`
	Count       int    `json:"count,omitempty"`
}

func reviewKeySegment(value any) string {
	trimmed := strings.TrimSpace(fmt.Sprint(value))
	if trimmed == "" || trimmed == "<nil>" {
		return ""
	}
	return strings.ReplaceAll(trimmed, "|", "/")
}

func buildGeoBreachReviewKey(ip, country, city string) string {
	return strings.Join([]string{
		"geo_breach",
		reviewKeySegment(ip),
		reviewKeySegment(country),
		reviewKeySegment(city),
	}, "|")
}

func parseGeoBreachReviewKey(reviewKey string) (ip, country, city string, ok bool) {
	parts := strings.Split(reviewKey, "|")
	if len(parts) != 4 || parts[0] != "geo_breach" {
		return "", "", "", false
	}
	return strings.TrimSpace(parts[1]), strings.TrimSpace(parts[2]), strings.TrimSpace(parts[3]), true
}

func buildSecurityAlertHealthIssue(alertType string, details map[string]any) (HealthIssue, string, bool) {
	switch strings.TrimSpace(alertType) {
	case "geo_breach":
		ip := reviewKeySegment(details["ip"])
		country := reviewKeySegment(details["country"])
		city := reviewKeySegment(details["city"])
		location := "unknown location"
		switch {
		case country != "" && city != "":
			location = fmt.Sprintf("%s (%s)", country, city)
		case country != "":
			location = country
		case city != "":
			location = city
		}

		desc := fmt.Sprintf("Access attempt from unauthorized location: %s", location)
		if ip != "" {
			desc += fmt.Sprintf(" via IP %s", ip)
		}
		desc += ". Review geo-fencing policy or mark the alert as reviewed after validation."

		reviewKey := buildGeoBreachReviewKey(ip, country, city)
		return HealthIssue{
			Type:        "security",
			Title:       "Geographic Access Breach",
			Description: desc,
			Fixable:     true,
			Reviewable:  true,
			ReviewKey:   reviewKey,
			ActionView:  "security_policies",
			ActionLabel: "Open Geo-Fencing",
		}, reviewKey, true
	case "system_error":
		return HealthIssue{
			Type:        "security",
			Title:       "System Configuration Error",
			Description: fmt.Sprintf("Error: %v", details["error"]),
		}, "system_error", true
	default:
		return HealthIssue{
			Type:        "security",
			Title:       "Security Alert",
			Description: "A security event was detected.",
		}, strings.TrimSpace(alertType), true
	}
}

// GetHealthIssues handles GET /api/project/health
func (h *Handler) GetHealthIssues(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()
	forceRefresh := strings.EqualFold(strings.TrimSpace(c.QueryParam("refresh")), "true")
	if !forceRefresh {
		if cached, ok := h.getCachedHealthIssues(); ok {
			return c.JSON(http.StatusOK, cached)
		}
	}

	// Initialize as empty slice so it marshals to [] instead of null if empty
	issues := make([]HealthIssue, 0)

	// 1. Formal RLS coverage by table/action (database policies, not only metadata flags)
	coverage, covErr := h.collectRLSPolicyCoverage(ctx)
	if covErr == nil {
		for _, item := range coverage {
			if !item.RLSDatabaseEnabled {
				issues = append(issues, HealthIssue{
					Type:        "security",
					Title:       fmt.Sprintf("Table `%s` does not have Row Level Security enabled", item.TableName),
					Description: "Enable native Postgres RLS and define per-action policies.",
				})
				continue
			}
			if len(item.MissingActions) > 0 && item.PolicyCount > 0 {
				issues = append(issues, HealthIssue{
					Type:        "security",
					Title:       fmt.Sprintf("Table `%s` is missing RLS policies for: %s", item.TableName, strings.Join(item.MissingActions, ", ")),
					Description: "Define policies for SELECT, INSERT, UPDATE, and DELETE to enforce full action coverage.",
				})
			}
		}
	}

	// 2. Check for Foreign Keys without indexes (Dynamic)
	rows, err := h.DB.Pool.Query(ctx, `
		WITH fk_columns AS (
			SELECT conrelid::regclass as table_name, n.nspname as schema_name, conname as constraint_name, a.attname as column_name
			FROM pg_constraint c
			JOIN pg_class cls ON cls.oid = c.conrelid
			JOIN pg_namespace n ON n.oid = cls.relnamespace
			CROSS JOIN LATERAL unnest(c.conkey) as col(num)
			JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = col.num
			WHERE c.contype = 'f'
			  AND n.nspname NOT IN ('auth', 'ozy_internal', 'storage', 'realtime', '_realtime', 'vault', 'net', 'information_schema', 'pg_catalog')
		),
		indexed_columns AS (
			SELECT indrelid::regclass as table_name, n.nspname as schema_name, a.attname as column_name
			FROM pg_index i
			JOIN pg_class cls ON cls.oid = i.indrelid
			JOIN pg_namespace n ON n.oid = cls.relnamespace
			CROSS JOIN LATERAL unnest(i.indkey) as col(num)
			JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = col.num
			WHERE n.nspname NOT IN ('auth', 'ozy_internal', 'storage', 'realtime', '_realtime', 'vault', 'net', 'information_schema', 'pg_catalog')
		)
		SELECT f.table_name::text, f.column_name, f.constraint_name
		FROM fk_columns f
		LEFT JOIN indexed_columns i ON f.table_name = i.table_name AND f.schema_name = i.schema_name AND f.column_name = i.column_name
		WHERE i.column_name IS NULL
		  AND f.table_name::text NOT LIKE '_v_%' AND f.table_name::text NOT LIKE '_ozy_%'
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var tableName, colName, conName string
			if err := rows.Scan(&tableName, &colName, &conName); err == nil {
				issues = append(issues, HealthIssue{
					Type:        "performance",
					Title:       fmt.Sprintf("Foreign Key `%s` in `%s` is missing an index", colName, tableName),
					Description: fmt.Sprintf("Missing index on FKs can cause slow deletes and updates on the parent table. (Constraint: %s)", conName),
				})
			}
		}
	}

	// 3. Check for high sequential scans (Real PostgreSQL statistics)
	var seqScanIssue bool
	rows, err = h.DB.Pool.Query(ctx, `
		SELECT schemaname, relname, seq_scan, idx_scan
		FROM pg_stat_user_tables
		WHERE schemaname NOT IN ('auth', 'ozy_internal', 'storage', 'realtime', '_realtime', 'vault', 'net')
		  AND seq_scan > COALESCE(idx_scan, 0) * 10
		  AND seq_scan > 1000
		  AND relname NOT LIKE '_v_%' AND relname NOT LIKE '_ozy_%'
		ORDER BY seq_scan DESC
		LIMIT 3
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var schemaName string
			var tableName string
			var seqScan, idxScan int64
			if err := rows.Scan(&schemaName, &tableName, &seqScan, &idxScan); err == nil {
				seqScanIssue = true
				qualifiedName := tableName
				if strings.TrimSpace(schemaName) != "" {
					qualifiedName = schemaName + "." + tableName
				}
				issues = append(issues, HealthIssue{
					Type:        "performance",
					Title:       fmt.Sprintf("Table `%s` has high sequential scans (%d seq vs %d idx)", qualifiedName, seqScan, idxScan),
					Description: "Consider adding indexes to frequently filtered columns or running ANALYZE.",
				})
			}
		}
	}
	// Only add generic warning if no specific tables found but stats suggest issues
	if !seqScanIssue {
		var totalSeq, totalIdx int64
		_ = h.DB.Pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(seq_scan), 0), COALESCE(SUM(idx_scan), 0)
			FROM pg_stat_user_tables
			WHERE schemaname NOT IN ('auth', 'ozy_internal', 'storage', 'realtime', '_realtime', 'vault', 'net')
		`).Scan(&totalSeq, &totalIdx)
		// Only warn if significant imbalance
		if totalSeq > 10000 && totalIdx == 0 {
			issues = append(issues, HealthIssue{
				Type:        "performance",
				Title:       "High number of sequential scans detected",
				Description: "Consider adding indexes to frequently filtered columns.",
			})
		}
	}

	// 4. Check for public access rules
	var publicCount int
	_ = h.DB.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_collections WHERE list_rule = 'public' AND name NOT LIKE '_v_%' AND name NOT LIKE '_ozy_%'").Scan(&publicCount)
	if publicCount > 0 {
		issues = append(issues, HealthIssue{
			Type:        "security",
			Title:       fmt.Sprintf("%d collections have public list rules", publicCount),
			Description: "Ensure this is intended and sensitive data is not exposed.",
		})
	}

	// 5. Check for unresolved security alerts
	rows, err = h.DB.Pool.Query(ctx, "SELECT type, severity, metadata FROM _v_security_alerts WHERE is_resolved = false ORDER BY created_at DESC LIMIT 10")
	if err == nil {
		defer rows.Close()
		type aggregatedAlert struct {
			issue HealthIssue
			count int
		}
		aggregated := make(map[string]*aggregatedAlert)
		order := make([]string, 0, 8)

		for rows.Next() {
			var aType, severity string
			var details map[string]any
			if err := rows.Scan(&aType, &severity, &details); err == nil {
				issue, aggregateKey, include := buildSecurityAlertHealthIssue(aType, details)
				if !include {
					continue
				}
				if aggregateKey == "" {
					aggregateKey = fmt.Sprintf("%s:%v", aType, details)
				}
				if existing, ok := aggregated[aggregateKey]; ok {
					existing.count++
					continue
				}
				aggregated[aggregateKey] = &aggregatedAlert{
					issue: issue,
					count: 1,
				}
				order = append(order, aggregateKey)
			}
		}

		for _, aggregateKey := range order {
			aggregate := aggregated[aggregateKey]
			if aggregate.count > 1 {
				aggregate.issue.Count = aggregate.count
			}
			issues = append(issues, aggregate.issue)
		}
	}

	for index := range issues {
		issues[index].Fixable = isHealthIssueAutoFixable(issues[index].Type, issues[index].Title)
	}

	h.setCachedHealthIssues(issues, 10*time.Second)
	return c.JSON(http.StatusOK, issues)
}

// FixHealthRequest represents a request to fix a health issue
type FixHealthRequest struct {
	Type  string `json:"type"`
	Issue string `json:"issue"`
}

type ReviewHealthRequest struct {
	Type      string `json:"type"`
	Issue     string `json:"issue"`
	ReviewKey string `json:"review_key"`
}

func parseQualifiedTableReference(raw string) (schemaName, tableName string, ok bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", "", false
	}

	parts := strings.Split(trimmed, ".")
	if len(parts) == 1 {
		table := strings.TrimSpace(parts[0])
		if !data.IsValidIdentifier(table) {
			return "", "", false
		}
		return "public", table, true
	}
	if len(parts) == 2 {
		schema := strings.TrimSpace(parts[0])
		table := strings.TrimSpace(parts[1])
		if !data.IsValidIdentifier(schema) || !data.IsValidIdentifier(table) {
			return "", "", false
		}
		return schema, table, true
	}

	return "", "", false
}

func extractHealthIssueTableReference(issue string) (schemaName, tableName string, ok bool) {
	parts := strings.Split(issue, "`")
	if len(parts) < 2 {
		return "", "", false
	}
	for index := 1; index < len(parts); index += 2 {
		token := strings.TrimSpace(parts[index])
		if !strings.Contains(token, ".") {
			continue
		}
		schemaName, tableName, ok = parseQualifiedTableReference(token)
		if ok {
			return schemaName, tableName, true
		}
	}
	for index := 1; index < len(parts); index += 2 {
		schemaName, tableName, ok = parseQualifiedTableReference(parts[index])
		if ok {
			return schemaName, tableName, true
		}
	}
	return "", "", false
}

func isSystemSchemaForHealthFix(schemaName string) bool {
	return categorizeSchema(schemaName) == "system"
}

func buildCreateIndexSQL(schemaName, tableName, indexName, colName string) string {
	qualifiedTable := data.QuoteIdentifier(schemaName) + "." + data.QuoteIdentifier(tableName)
	return fmt.Sprintf("CREATE INDEX IF NOT EXISTS %s ON %s (%s)", data.QuoteIdentifier(indexName), qualifiedTable, data.QuoteIdentifier(colName))
}

func buildAnalyzeTableSQL(schemaName, tableName string) string {
	qualifiedTable := data.QuoteIdentifier(schemaName) + "." + data.QuoteIdentifier(tableName)
	return "ANALYZE " + qualifiedTable
}

func buildQualifiedRegclassLiteral(schemaName, tableName string) string {
	return data.QuoteIdentifier(schemaName) + "." + data.QuoteIdentifier(tableName)
}

func isRLSHealthFixIssue(issueType, issue string) bool {
	typeLower := strings.ToLower(strings.TrimSpace(issueType))
	if typeLower != "security" {
		return false
	}
	issueLower := strings.ToLower(issue)
	return strings.Contains(issueLower, "row level security") ||
		strings.Contains(issueLower, "missing rls policies") ||
		strings.Contains(issueLower, " rls ")
}

func normalizeAllowedCountries(raw any) []string {
	next := make([]string, 0)
	push := func(country string) {
		canonical := canonicalGeoCountryValue(country)
		if canonical == "" || containsFold(next, canonical) {
			return
		}
		next = append(next, canonical)
	}

	switch value := raw.(type) {
	case []string:
		for _, country := range value {
			push(country)
		}
		return next
	case []any:
		for _, item := range value {
			push(fmt.Sprint(item))
		}
		return next
	default:
		return []string{}
	}
}

func canonicalGeoCountryValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "<nil>" {
		return ""
	}
	if region, err := language.ParseRegion(strings.ToUpper(trimmed)); err == nil {
		if displayName := strings.TrimSpace(display.English.Regions().Name(region)); displayName != "" {
			return displayName
		}
	}
	if trimmed == strings.ToUpper(trimmed) || trimmed == strings.ToLower(trimmed) {
		return cases.Title(language.English).String(strings.ToLower(trimmed))
	}
	return trimmed
}

func containsFold(values []string, target string) bool {
	for _, value := range values {
		if geoCountryValuesMatch(value, target) {
			return true
		}
	}
	return false
}

func geoCountryValuesMatch(left string, right string) bool {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == "" || right == "" {
		return false
	}
	if strings.EqualFold(left, right) {
		return true
	}
	if normalizeGeoCountryLabel(left) == normalizeGeoCountryLabel(right) {
		return true
	}
	if region, err := language.ParseRegion(strings.ToUpper(left)); err == nil {
		if displayName := strings.TrimSpace(display.English.Regions().Name(region)); displayName != "" {
			if strings.EqualFold(displayName, right) || normalizeGeoCountryLabel(displayName) == normalizeGeoCountryLabel(right) {
				return true
			}
		}
	}
	if region, err := language.ParseRegion(strings.ToUpper(right)); err == nil {
		if displayName := strings.TrimSpace(display.English.Regions().Name(region)); displayName != "" {
			if strings.EqualFold(displayName, left) || normalizeGeoCountryLabel(displayName) == normalizeGeoCountryLabel(left) {
				return true
			}
		}
	}
	return false
}

func normalizeGeoCountryLabel(value string) string {
	var builder strings.Builder
	for _, r := range strings.TrimSpace(strings.ToLower(value)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func (h *Handler) resolveGeoBreachAlerts(ctx context.Context, reviewKey string) (int64, error) {
	ip, country, city, ok := parseGeoBreachReviewKey(strings.TrimSpace(reviewKey))
	var tag pgconn.CommandTag
	var err error
	if ok {
		tag, err = h.DB.Pool.Exec(ctx, `
			UPDATE _v_security_alerts
			SET is_resolved = true
			WHERE type = 'geo_breach'
			  AND is_resolved = false
			  AND COALESCE(metadata->>'ip', '') = $1
			  AND COALESCE(metadata->>'country', '') = $2
			  AND COALESCE(metadata->>'city', '') = $3
		`, ip, country, city)
	} else {
		tag, err = h.DB.Pool.Exec(ctx, `
			UPDATE _v_security_alerts
			SET is_resolved = true
			WHERE type = 'geo_breach'
			  AND is_resolved = false
		`)
	}
	if err != nil {
		return 0, err
	}
	h.invalidateHealthIssuesCache()
	return tag.RowsAffected(), nil
}

func isHealthIssueAutoFixable(issueType, issue string) bool {
	typeLower := strings.ToLower(strings.TrimSpace(issueType))
	issueLower := strings.ToLower(strings.TrimSpace(issue))

	if typeLower == "performance" {
		if schemaName, _, ok := extractHealthIssueTableReference(issue); ok && isSystemSchemaForHealthFix(schemaName) {
			return false
		}
	}

	if isRLSHealthFixIssue(issueType, issue) {
		return true
	}
	if typeLower == "security" && strings.Contains(issueLower, "public list rules") {
		return true
	}
	if typeLower == "security" && strings.Contains(issueLower, "geographic access breach") {
		return true
	}
	if typeLower == "performance" && strings.Contains(issueLower, "sequential scans") {
		return true
	}
	if typeLower == "performance" && strings.Contains(issueLower, "missing an index") {
		return true
	}
	return false
}

func resolveLatestUnresolvedGeoBreachCountry(ctx context.Context, tx pgx.Tx) (string, error) {
	var rawMetadata []byte
	err := tx.QueryRow(ctx, `
		SELECT metadata
		FROM _v_security_alerts
		WHERE type = 'geo_breach' AND is_resolved = false
		ORDER BY created_at DESC
		LIMIT 1
	`).Scan(&rawMetadata)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}

	var metadata map[string]any
	if len(rawMetadata) > 0 {
		if err := json.Unmarshal(rawMetadata, &metadata); err != nil {
			return "", err
		}
	}

	country := strings.TrimSpace(fmt.Sprint(metadata["country"]))
	if country == "" || country == "<nil>" || strings.EqualFold(country, "unknown") {
		return "", nil
	}
	return country, nil
}

func normalizeRLSColumnType(raw string) string {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" || normalized == "user-defined" {
		return ""
	}
	return normalized
}

func buildRLSOwnerRule(columnName, columnType string) string {
	switch normalizeRLSColumnType(columnType) {
	case "uuid":
		return fmt.Sprintf("%s = auth.uid()", columnName)
	case "text", "character varying", "varchar", "character", "char", "citext":
		return fmt.Sprintf("%s::text = auth.uid()::text", columnName)
	default:
		return ""
	}
}

func inferRLSAutoFixRuleFromColumns(tableName string, columnTypes map[string]string) string {
	for _, candidate := range []string{"owner_id", "user_id", "created_by"} {
		if columnType, ok := columnTypes[candidate]; ok {
			if rule := buildRLSOwnerRule(candidate, columnType); rule != "" {
				return rule
			}
		}
	}

	if tableName == "users" || tableName == "_v_users" {
		if columnType, ok := columnTypes["id"]; ok {
			if rule := buildRLSOwnerRule("id", columnType); rule != "" {
				return rule
			}
		}
	}

	// Default to admin-only access if no compatible ownership column is found
	// to enforce secure by default rather than throwing an error.
	return "auth.role() = 'admin'"
}

func dropManagedRLSPolicies(ctx context.Context, tx pgx.Tx, tableName string) {
	legacyPolicy := fmt.Sprintf("policy_ozy_%s", tableName)
	_, _ = tx.Exec(ctx, fmt.Sprintf("DROP POLICY IF EXISTS %s ON %s", data.QuoteIdentifier(legacyPolicy), data.QuoteIdentifier(tableName)))
	for _, action := range rlsActions {
		policyName := makePolicyName(tableName, action)
		_, _ = tx.Exec(ctx, fmt.Sprintf("DROP POLICY IF EXISTS %s ON %s", data.QuoteIdentifier(policyName), data.QuoteIdentifier(tableName)))
	}
}

func resolveRLSAutoFixRule(ctx context.Context, tx pgx.Tx, tableName string) (string, error) {
	columnTypes, err := getTableColumnTypes(ctx, tx, tableName)
	if err != nil {
		return "", err
	}

	if rule := inferRLSAutoFixRuleFromColumns(tableName, columnTypes); rule != "" {
		return rule, nil
	}

	var rule string
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(qual, ''), NULLIF(with_check, ''))
		FROM pg_policies
		WHERE schemaname = 'public' AND tablename = $1
		ORDER BY
			CASE cmd
				WHEN 'SELECT' THEN 0
				WHEN 'UPDATE' THEN 1
				WHEN 'DELETE' THEN 2
				WHEN 'INSERT' THEN 3
				ELSE 4
			END,
			policyname
		LIMIT 1
	`, tableName).Scan(&rule)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}

	return strings.TrimSpace(rule), nil
}

func (h *Handler) applyCollectionRLSConfig(ctx context.Context, tx pgx.Tx, tableName string, enabled bool, forceRLS bool, singleRule string, perAction map[string]string, perActionRoles map[string][]string) (string, error) {
	if !data.IsValidIdentifier(tableName) {
		return "", fmt.Errorf("invalid table name")
	}

	if !enabled {
		if err := h.DB.SetRLSForce(ctx, tx, tableName, false); err != nil {
			return "", err
		}
		dropManagedRLSPolicies(ctx, tx, tableName)
		if err := h.DB.DisableRLS(ctx, tx, tableName); err != nil {
			return "", err
		}
		return "", nil
	}

	if err := validateRLSPolicyActions(perAction); err != nil {
		return "", err
	}
	if err := validateRLSPolicyRoles(perActionRoles); err != nil {
		return "", err
	}

	policies := normalizeRLSPolicies(singleRule, perAction)
	rolesByAction := normalizeRLSPolicyRoles(perActionRoles)
	if err := ensureRLSCompatibilityLayer(ctx, tx); err != nil {
		return "", err
	}
	if err := ensureRLSPolicyRolesExist(ctx, tx, perActionRoles); err != nil {
		return "", err
	}
	if primaryRLSRule(singleRule, policies) == "" {
		if err := h.DB.EnableRLS(ctx, tx, tableName); err != nil {
			return "", err
		}
		if err := h.DB.SetRLSForce(ctx, tx, tableName, forceRLS); err != nil {
			return "", err
		}
		dropManagedRLSPolicies(ctx, tx, tableName)
		return "", nil
	}

	if err := h.DB.EnableRLS(ctx, tx, tableName); err != nil {
		return "", err
	}
	if err := h.DB.SetRLSForce(ctx, tx, tableName, forceRLS); err != nil {
		return "", err
	}

	dropManagedRLSPolicies(ctx, tx, tableName)
	for _, action := range rlsActions {
		expression := strings.TrimSpace(policies[action])
		if expression == "" {
			continue
		}
		if err := validateRLSExpression(ctx, tx, tableName, expression); err != nil {
			return "", err
		}
		policyName := makePolicyName(tableName, action)
		if err := h.DB.CreatePolicyForAction(ctx, tx, tableName, policyName, action, expression, rolesByAction[action]); err != nil {
			return "", err
		}
	}

	return primaryRLSRule(singleRule, policies), nil
}

// FixHealthIssues handles POST /api/project/health/fix
func (h *Handler) FixHealthIssues(c echo.Context) error {
	var req FixHealthRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	log.Printf("applying health fix type=%s issue=%s", req.Type, req.Issue)

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	issueLower := strings.ToLower(req.Issue)
	typeLower := strings.ToLower(req.Type)

	if isRLSHealthFixIssue(req.Type, req.Issue) {
		// Extract table name from issue title: "Table `tablename` does not have..."
		parts := strings.Split(req.Issue, "`")
		if len(parts) < 3 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Could not identify table"})
		}
		tableName := parts[1]

		if !data.IsValidIdentifier(tableName) {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid table name"})
		}

		// Apply RLS
		tx, err := h.DB.Pool.Begin(ctx)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Transaction failed"})
		}
		defer func() { _ = tx.Rollback(ctx) }()

		rule, ruleErr := resolveRLSAutoFixRule(ctx, tx, tableName)
		if ruleErr != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to resolve RLS auto-fix rule: " + ruleErr.Error(),
			})
		}
		if rule == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "RLS auto-fix could not resolve a safe rule for this table",
			})
		}

		if _, err := h.applyCollectionRLSConfig(ctx, tx, tableName, true, false, rule, nil, nil); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) {
				switch pgErr.Code {
				case "42601", "42703", "42883":
					return c.JSON(http.StatusBadRequest, map[string]string{"error": "Failed to create RLS policy: " + pgErr.Message})
				}
			}
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create RLS policy: " + err.Error()})
		}

		_, err = tx.Exec(ctx, `
			UPDATE _v_collections
			SET rls_enabled = true, rls_rule = $2, list_rule = 'auth', create_rule = 'admin', update_rule = 'auth', delete_rule = 'auth'
			WHERE name = $1
		`, tableName, rule)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update metadata: " + err.Error()})
		}

		if err := tx.Commit(ctx); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to commit fix"})
		}

		h.invalidateHealthIssuesCache()
		return c.JSON(http.StatusOK, map[string]string{"message": "RLS enabled successfully"})
	}

	if typeLower == "performance" && strings.Contains(issueLower, "sequential scans") {
		// Extract table from issue: "Table `schema.table` has high sequential scans..."
		schemaName, tableName, ok := extractHealthIssueTableReference(req.Issue)
		if ok {
			if isSystemSchemaForHealthFix(schemaName) {
				log.Printf("skipping health performance fix for system table=%s.%s", schemaName, tableName)
				return c.JSON(http.StatusBadRequest, map[string]string{"error": "Auto-fix is not available for system tables"})
			}
			if data.IsValidIdentifier(schemaName) && data.IsValidIdentifier(tableName) {
				// 1. Create index on commonly queried columns (id is always indexed, but let's ensure others)
				// Get columns that might benefit from indexing
				columns, err := h.DB.Pool.Query(ctx, `
					SELECT column_name FROM information_schema.columns 
					WHERE table_name = $1 
					  AND table_schema = $2
					  AND column_name NOT IN ('id', 'created_at', 'updated_at', 'deleted_at')
					  AND data_type IN ('uuid', 'integer', 'bigint', 'text', 'varchar', 'boolean')
					LIMIT 3
				`, tableName, schemaName)
				if err == nil {
					defer columns.Close()
					for columns.Next() {
						var colName string
						if columns.Scan(&colName) == nil && data.IsValidIdentifier(colName) {
							indexName := fmt.Sprintf("idx_%s_%s", tableName, colName)
							sql := buildCreateIndexSQL(schemaName, tableName, indexName, colName)
							_, _ = h.DB.Pool.Exec(ctx, sql)
						}
					}
				}

				// 2. Run ANALYZE on specific table
				sql := buildAnalyzeTableSQL(schemaName, tableName)
				_, _ = h.DB.Pool.Exec(ctx, sql)

				// 3. Reset statistics for this table
				_, _ = h.DB.Pool.Exec(ctx, "SELECT pg_stat_reset_single_table_counters($1::regclass::oid)", buildQualifiedRegclassLiteral(schemaName, tableName))

				return c.JSON(http.StatusOK, map[string]string{
					"message": fmt.Sprintf("Created indexes, analyzed table '%s.%s', and reset statistics", schemaName, tableName),
				})
			}
		}

		// Fallback: Run global ANALYZE and reset all stats
		if _, err := h.DB.Pool.Exec(ctx, "ANALYZE"); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to run ANALYZE: " + err.Error()})
		}
		// Reset all user table stats
		_, _ = h.DB.Pool.Exec(ctx, "SELECT pg_stat_reset()")
		return c.JSON(http.StatusOK, map[string]string{"message": "Database statistics updated and counters reset"})
	}

	if typeLower == "security" && strings.Contains(issueLower, "public list rules") {
		// Fix: Change all public list rules to 'auth'
		_, err := h.DB.Pool.Exec(ctx, "UPDATE _v_collections SET list_rule = 'auth' WHERE list_rule = 'public'")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update collection rules: " + err.Error()})
		}
		return c.JSON(http.StatusOK, map[string]string{"message": "Public collections updated to Auth-only access"})
	}

	if typeLower == "security" && strings.Contains(issueLower, "geographic access breach") {
		tx, err := h.DB.Pool.Begin(ctx)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Transaction failed"})
		}
		defer func() { _ = tx.Rollback(ctx) }()

		country, err := resolveLatestUnresolvedGeoBreachCountry(ctx, tx)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to inspect geo breach details: " + err.Error()})
		}
		if country == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "No unresolved geo-breach alert with a valid country was found"})
		}

		policy := map[string]any{
			"enabled":           true,
			"blocked_countries": []string{},
		}

		var rawConfig []byte
		err = tx.QueryRow(ctx, "SELECT config FROM _v_security_policies WHERE type = 'geo_fencing'").Scan(&rawConfig)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load geo-fencing policy: " + err.Error()})
		}
		if len(rawConfig) > 0 {
			if err := json.Unmarshal(rawConfig, &policy); err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to parse geo-fencing policy: " + err.Error()})
			}
		}

		blockedCountries := normalizeAllowedCountries(policy["blocked_countries"])
		if len(blockedCountries) == 0 {
			blockedCountries = normalizeAllowedCountries(policy["allowed_countries"])
		}
		if !containsFold(blockedCountries, country) {
			blockedCountries = append(blockedCountries, country)
		}
		policy["enabled"] = true
		policy["blocked_countries"] = blockedCountries
		delete(policy, "allowed_countries")

		configJSON, marshalErr := json.Marshal(policy)
		if marshalErr != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to serialize geo-fencing policy: " + marshalErr.Error()})
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO _v_security_policies (type, config, updated_at)
			VALUES ('geo_fencing', $1, NOW())
			ON CONFLICT (type) DO UPDATE SET config = $1, updated_at = NOW()
		`, configJSON); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update geo-fencing policy: " + err.Error()})
		}

		if _, err := tx.Exec(ctx, `
			UPDATE _v_security_alerts
			SET is_resolved = true
			WHERE type = 'geo_breach' AND is_resolved = false
		`); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to resolve geo-breach alerts: " + err.Error()})
		}

		if err := tx.Commit(ctx); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to commit geo-breach fix"})
		}

		h.Geo.InvalidatePolicy()
		h.invalidateHealthIssuesCache()
		return c.JSON(http.StatusOK, map[string]string{"message": "Geo-fencing blocklist updated and geo-breach alerts resolved"})
	}

	if typeLower == "performance" && strings.Contains(issueLower, "missing an index") {
		// Extract column and table from: "Foreign Key `column` in `schema.table` is missing an index"
		parts := strings.Split(req.Issue, "`")
		if len(parts) < 5 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Could not identify table or column"})
		}
		colName := parts[1]
		schemaName, tableName, ok := parseQualifiedTableReference(parts[3])
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Could not identify table schema"})
		}
		if isSystemSchemaForHealthFix(schemaName) {
			log.Printf("skipping health index fix for system table=%s.%s", schemaName, tableName)
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Auto-fix is not available for system tables"})
		}

		if !data.IsValidIdentifier(schemaName) || !data.IsValidIdentifier(tableName) || !data.IsValidIdentifier(colName) {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid identifiers"})
		}

		// Create index
		indexName := fmt.Sprintf("idx_%s_%s", tableName, colName)
		sql := buildCreateIndexSQL(schemaName, tableName, indexName, colName)
		if _, err := h.DB.Pool.Exec(ctx, sql); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create index: " + err.Error()})
		}
		return c.JSON(http.StatusOK, map[string]string{"message": "Index created successfully"})
	}

	log.Printf("health fix strategy not found type=%q issue=%q", req.Type, req.Issue)
	return c.JSON(http.StatusBadRequest, map[string]string{
		"error":      "Fix strategy not found for this issue: " + req.Issue,
		"error_code": "FIX_STRATEGY_NOT_FOUND",
	})
}

// UpdateCollectionRLS handles PATCH /api/collections/rls
func (h *Handler) UpdateCollectionRLS(c echo.Context) error {
	var req UpdateCollectionRLSRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	req.Name = strings.TrimSpace(req.Name)
	if !data.IsValidIdentifier(req.Name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid collection name"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to start transaction"})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM _v_collections WHERE name = $1)`, req.Name).Scan(&exists); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load collection metadata"})
	}
	if !exists {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Collection not found"})
	}

	forceRLS := false
	if err := tx.QueryRow(ctx, `
		SELECT c.relforcerowsecurity
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relname = $1
	`, req.Name).Scan(&forceRLS); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load current FORCE RLS status"})
	}
	if req.RlsForce != nil {
		forceRLS = *req.RlsForce
	}

	resolvedRule, err := h.applyCollectionRLSConfig(ctx, tx, req.Name, req.Enabled, forceRLS, req.RlsRule, req.RlsPolicies, req.RlsRoles)
	if err != nil {
		if errAction := validateRLSPolicyActions(req.RlsPolicies); errAction != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error":      errAction.Error(),
				"error_code": "RLS_INVALID_ACTION",
			})
		}
		if errRole := validateRLSPolicyRoles(req.RlsRoles); errRole != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error":      errRole.Error(),
				"error_code": "RLS_INVALID_ROLE",
			})
		}
		if strings.Contains(strings.ToLower(err.Error()), "invalid rls role") {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error":      err.Error(),
				"error_code": "RLS_INVALID_ROLE",
			})
		}

		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			switch pgErr.Code {
			case "42703":
				return c.JSON(http.StatusBadRequest, map[string]string{
					"error":      "Invalid RLS policy: one or more referenced columns do not exist",
					"error_code": "RLS_INVALID_COLUMN",
				})
			case "42601", "42883":
				return c.JSON(http.StatusBadRequest, map[string]string{
					"error":      "Invalid RLS policy expression: " + pgErr.Message,
					"error_code": "RLS_INVALID_EXPRESSION",
				})
			}
		}

		if strings.Contains(err.Error(), "safe rule") {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update RLS: " + err.Error()})
	}

	metadataRule := strings.TrimSpace(resolvedRule)
	if !req.Enabled {
		metadataRule = ""
	}
	commandTag, err := tx.Exec(ctx, `
		UPDATE _v_collections
		SET rls_enabled = $2, rls_rule = $3, updated_at = NOW()
		WHERE name = $1
	`, req.Name, req.Enabled, metadataRule)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update metadata: " + err.Error()})
	}
	if commandTag.RowsAffected() == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Collection not found"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to commit transaction"})
	}

	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()

	return c.JSON(http.StatusOK, map[string]any{
		"name":        req.Name,
		"rls_enabled": req.Enabled,
		"rls_force":   req.Enabled && forceRLS,
		"rls_rule":    metadataRule,
		"message": map[bool]string{
			true:  "RLS enabled successfully",
			false: "RLS disabled successfully",
		}[req.Enabled],
	})
}

// ReviewHealthIssues handles POST /api/project/health/review
func (h *Handler) ReviewHealthIssues(c echo.Context) error {
	var req ReviewHealthRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	typeLower := strings.ToLower(strings.TrimSpace(req.Type))
	issueLower := strings.ToLower(strings.TrimSpace(req.Issue))
	if typeLower != "security" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Only security review flows are supported"})
	}

	if strings.Contains(issueLower, "geographic access breach") || strings.HasPrefix(strings.TrimSpace(req.ReviewKey), "geo_breach|") {
		affected, err := h.resolveGeoBreachAlerts(ctx, req.ReviewKey)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to review geo breach alerts: " + err.Error()})
		}
		if affected == 0 {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "No matching geo breach alerts were pending review"})
		}
		return c.JSON(http.StatusOK, map[string]any{
			"message":        "Geo breach alerts marked as reviewed",
			"rows_affected":  affected,
			"reviewed_issue": req.Issue,
		})
	}

	return c.JSON(http.StatusBadRequest, map[string]string{
		"error": "Review strategy not found for this issue: " + req.Issue,
	})
}

type EnforceRLSResult struct {
	Table          string   `json:"table"`
	Status         string   `json:"status"`
	Rule           string   `json:"rule,omitempty"`
	ActionsApplied []string `json:"actions_applied,omitempty"`
	Description    string   `json:"description,omitempty"`
}

func (h *Handler) enforceRLSAllInternal(ctx context.Context, dryRun bool, rulePattern string) ([]EnforceRLSResult, int, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT name
		FROM _v_collections
		WHERE name NOT LIKE '_v_%' AND name NOT LIKE '_ozy_%'
		ORDER BY name
	`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	collections := make([]string, 0, 16)
	for rows.Next() {
		var name string
		if scanErr := rows.Scan(&name); scanErr == nil {
			collections = append(collections, name)
		}
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	results := make([]EnforceRLSResult, 0, len(collections))
	enforcedCount := 0
	if err := ensureRLSCompatibilityLayer(ctx, tx); err != nil {
		return nil, 0, err
	}
	for _, tableName := range collections {
		if !data.IsValidIdentifier(tableName) {
			results = append(results, EnforceRLSResult{
				Table:       tableName,
				Status:      "skipped",
				Description: "invalid identifier",
			})
			continue
		}

		rule, ownerErr := resolveRLSAutoFixRule(ctx, tx, tableName)
		if ownerErr != nil || strings.TrimSpace(rule) == "" || strings.EqualFold(strings.TrimSpace(rule), "auth.role() = 'admin'") {
			results = append(results, EnforceRLSResult{
				Table:       tableName,
				Status:      "skipped",
				Description: "owner column missing or incompatible with auth.uid() (owner_id/user_id/created_by)",
			})
			continue
		}

		if custom := strings.TrimSpace(rulePattern); custom != "" {
			rule = custom
		}
		if exprErr := validateRLSExpression(ctx, tx, tableName, rule); exprErr != nil {
			results = append(results, EnforceRLSResult{
				Table:       tableName,
				Status:      "error",
				Description: "invalid policy expression",
			})
			continue
		}

		if dryRun {
			results = append(results, EnforceRLSResult{
				Table:          tableName,
				Status:         "preview",
				Rule:           rule,
				ActionsApplied: append([]string{}, rlsActions...),
				Description:    "preview only (no changes applied)",
			})
			continue
		}

		enableSQL := fmt.Sprintf("ALTER TABLE %s ENABLE ROW LEVEL SECURITY", data.QuoteIdentifier(tableName))
		if _, execErr := tx.Exec(ctx, enableSQL); execErr != nil {
			results = append(results, EnforceRLSResult{
				Table:       tableName,
				Status:      "error",
				Description: "failed to enable native RLS",
			})
			continue
		}

		dropManagedRLSPolicies(ctx, tx, tableName)
		applied := make([]string, 0, len(rlsActions))
		policyErr := false
		for _, action := range rlsActions {
			policyName := makePolicyName(tableName, action)
			if err := h.DB.CreatePolicyForAction(ctx, tx, tableName, policyName, action, rule, nil); err != nil {
				results = append(results, EnforceRLSResult{
					Table:       tableName,
					Status:      "error",
					Description: fmt.Sprintf("failed to create RLS %s policy", action),
				})
				policyErr = true
				break
			}
			applied = append(applied, action)
		}
		if policyErr {
			continue
		}

		if _, metaErr := tx.Exec(ctx, `
			UPDATE _v_collections
			SET rls_enabled = true, rls_rule = $2, list_rule = 'auth', create_rule = 'admin', update_rule = 'auth', delete_rule = 'auth'
			WHERE name = $1
		`, tableName, rule); metaErr != nil {
			results = append(results, EnforceRLSResult{
				Table:       tableName,
				Status:      "error",
				Description: "failed to update metadata",
			})
			continue
		}

		results = append(results, EnforceRLSResult{
			Table:          tableName,
			Status:         "enforced",
			Rule:           rule,
			ActionsApplied: append([]string{}, applied...),
			Description:    "native and metadata RLS enabled with per-action policies",
		})
		enforcedCount++
	}

	if dryRun {
		return results, 0, nil
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, 0, err
	}
	h.invalidateHealthIssuesCache()
	return results, enforcedCount, nil
}

// EnforceRLSAll enables RLS on all user collections with an owner column and tightens ACL defaults.
func (h *Handler) EnforceRLSAll(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
	defer cancel()

	var req struct {
		DryRun      bool   `json:"dry_run"`
		RulePattern string `json:"rule_pattern"`
	}
	if err := c.Bind(&req); err != nil && !errors.Is(err, io.EOF) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	dryRun := req.DryRun || strings.EqualFold(strings.TrimSpace(c.QueryParam("dry_run")), "true")

	results, enforcedCount, err := h.enforceRLSAllInternal(ctx, dryRun, req.RulePattern)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to enforce RLS policies"})
	}

	if dryRun {
		return c.JSON(http.StatusOK, map[string]any{
			"status":   "preview",
			"dry_run":  true,
			"results":  results,
			"enforced": 0,
		})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":   "ok",
		"enforced": enforcedCount,
		"results":  results,
	})
}


func getTableColumnTypes(ctx context.Context, tx pgx.Tx, tableName string) (map[string]string, error) {
	rows, err := tx.Query(ctx, `
		SELECT column_name, data_type, udt_name
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1
	`, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	types := map[string]string{}
	for rows.Next() {
		var (
			columnName string
			dataType   string
			udtName    string
		)
		if scanErr := rows.Scan(&columnName, &dataType, &udtName); scanErr != nil {
			continue
		}

		key := strings.ToLower(strings.TrimSpace(columnName))
		normalizedType := strings.ToLower(strings.TrimSpace(dataType))
		if normalizedType == "user-defined" {
			normalizedUdt := strings.ToLower(strings.TrimSpace(udtName))
			if normalizedUdt != "" {
				normalizedType = normalizedUdt
			}
		}
		types[key] = normalizedType
	}

	return types, rows.Err()
}
