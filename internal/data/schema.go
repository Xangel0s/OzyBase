package data

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
)

// FieldSchema represents a single field in a collection schema
type FieldSchema struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Required   bool   `json:"required,omitempty"`
	Unique     bool   `json:"unique,omitempty"`
	IsPrimary  bool   `json:"is_primary,omitempty"`
	Default    any    `json:"default,omitempty"`
	References string `json:"references,omitempty"` // format: "table.column"
}

type UpdateColumnOptions struct {
	NextName    string
	Type        string
	Required    *bool
	DefaultMode string
	Default     any
}

func normalizeIdentifierList(values []string) ([]string, error) {
	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	for _, raw := range values {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		if !IsValidIdentifier(name) {
			return nil, fmt.Errorf("invalid column name: %s", raw)
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		normalized = append(normalized, name)
	}
	return normalized, nil
}

func equalIdentifierSlices(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

// TypeMapping maps OzyBase types to PostgreSQL types
var TypeMapping = map[string]string{
	"int2":        "INT2",
	"int4":        "INT4",
	"int8":        "INT8",
	"float4":      "FLOAT4",
	"float8":      "FLOAT8",
	"numeric":     "NUMERIC",
	"json":        "JSON",
	"jsonb":       "JSONB",
	"text":        "TEXT",
	"varchar":     "VARCHAR",
	"uuid":        "UUID",
	"date":        "DATE",
	"time":        "TIME",
	"timetz":      "TIMETZ",
	"timestamp":   "TIMESTAMP",
	"timestamptz": "TIMESTAMPTZ",
	"bool":        "BOOL",
	"boolean":     "BOOLEAN",
	"bytea":       "BYTEA",
	"inet":        "INET",
	"cidr":        "CIDR",
	"macaddr":     "MACADDR",
	"interval":    "INTERVAL",
	"money":       "MONEY",
	"text_array":  "TEXT[]",
	"int_array":   "INT4[]",
	// Aliases
	"number":  "INT4",
	"integer": "INT4",
	"string":  "TEXT",
}

// QuoteIdentifier safely quotes a PostgreSQL identifier after prior validation.
func QuoteIdentifier(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// BuildCreateTableSQL generates a CREATE TABLE statement from a schema definition
func BuildCreateTableSQL(tableName string, schema []FieldSchema) (string, error) {
	if tableName == "" {
		return "", fmt.Errorf("table name cannot be empty")
	}

	if len(schema) == 0 {
		return "", fmt.Errorf("schema cannot be empty")
	}

	// Validate table name (prevent SQL injection)
	if !IsValidIdentifier(tableName) {
		return "", fmt.Errorf("invalid table name: %s", tableName)
	}

	var columns []string
	var primaryKeys []string

	for _, field := range schema {
		if field.IsPrimary {
			primaryKeys = append(primaryKeys, field.Name)
		}
	}

	for _, field := range schema {
		if !IsValidIdentifier(field.Name) {
			return "", fmt.Errorf("invalid field name: %s", field.Name)
		}

		pgType, ok := TypeMapping[strings.ToLower(field.Type)]
		if !ok {
			return "", fmt.Errorf("unknown type: %s", field.Type)
		}

		col := fmt.Sprintf("%s %s", QuoteIdentifier(field.Name), pgType)

		if field.IsPrimary && !strings.Contains(strings.Join(columns, ""), "PRIMARY KEY") {
			// If it's the only PK or we use table-level PK for composite
			// For now OzyBase supports single PK better in UI
			if len(primaryKeys) == 1 {
				col += " PRIMARY KEY"
			}
		}

		if field.Required {
			col += " NOT NULL"
		}

		if field.Unique {
			col += " UNIQUE"
		}

		if field.References != "" {
			refParts := strings.Split(field.References, ".")
			if len(refParts) == 2 {
				refTable, refCol := refParts[0], refParts[1]
				if IsValidIdentifier(refTable) && IsValidIdentifier(refCol) {
					col += fmt.Sprintf(" REFERENCES %s(%s) ON DELETE CASCADE", QuoteIdentifier(refTable), QuoteIdentifier(refCol))
				}
			}
		}

		if field.Default != nil {
			col += fmt.Sprintf(" DEFAULT %s", formatDefault(field.Default, field.Type))
		}

		columns = append(columns, col)
	}

	// Total schema flexibility: only add columns explicitly defined in the schema.

	// #nosec G201
	sql := fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (\n\t%s\n)",
		QuoteIdentifier(tableName),
		strings.Join(columns, ",\n\t"))

	return sql, nil
}

// IsValidIdentifier checks if a string is a valid SQL identifier
func IsValidIdentifier(name string) bool {
	if len(name) == 0 || len(name) > 63 {
		return false
	}

	for i, r := range name {
		if i == 0 {
			// Must start with letter or underscore
			if !unicode.IsLetter(r) && r != '_' {
				return false
			}
		} else {
			// Rest can be letters, digits, or underscores
			if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' {
				return false
			}
		}
	}

	return true
}

// IsValidFunctionName checks if a function name is valid (allowing hyphens)
func IsValidFunctionName(name string) bool {
	if len(name) == 0 || len(name) > 63 {
		return false
	}

	for i, r := range name {
		if i == 0 {
			if !unicode.IsLetter(r) && r != '_' {
				return false
			}
		} else {
			if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' && r != '-' {
				return false
			}
		}
	}

	return true
}

// formatDefault formats a default value for SQL
func formatDefault(value any, _ string) string {
	switch v := value.(type) {
	case bool:
		if v {
			return "TRUE"
		}
		return "FALSE"
	case string:
		exprLower := strings.ToLower(strings.TrimSpace(v))
		// Check for common SQL expressions that should not be quoted as string literals
		if exprLower == "gen_random_uuid()" || exprLower == "now()" || exprLower == "current_timestamp" || exprLower == "current_date" || exprLower == "current_time" || exprLower == "auth.uid()" || exprLower == "(auth.uid())" || exprLower == "auth.team_id()" || exprLower == "auth.workspace_id()" || strings.HasPrefix(exprLower, "nextval(") {
			return v
		}
		return fmt.Sprintf("'%s'", strings.ReplaceAll(v, "'", "''"))
	case float64, int:
		return fmt.Sprintf("%v", v)
	default:
		return fmt.Sprintf("'%v'", v)
	}
}

// GetTableSchema fetches the schema of a table from information_schema
func (db *DB) GetTableSchema(ctx context.Context, tableName string) ([]FieldSchema, error) {
	if !IsValidIdentifier(tableName) {
		return nil, fmt.Errorf("invalid table name: %s", tableName)
	}

	rows, err := db.Pool.Query(ctx, `SELECT name, type, udt, nullable, default_value, is_pk FROM ozy_internal.get_table_columns($1)`, tableName)
	if err != nil {
		return nil, fmt.Errorf("failed to query table schema: %w", err)
	}
	defer rows.Close()

	var fields []FieldSchema
	for rows.Next() {
		var colName, dataType, udtName string
		var nullable bool
		var columnDefault *string
		var isPk bool

		if err := rows.Scan(&colName, &dataType, &udtName, &nullable, &columnDefault, &isPk); err != nil {
			return nil, fmt.Errorf("failed to scan column schema: %w", err)
		}

		// A field is only strictly required if it is NOT NULL AND has no default value.
		isRequired := !nullable && (columnDefault == nil)

		fields = append(fields, FieldSchema{
			Name:     colName,
			Type:     mapPostgresTypeToOzyWithUDT(dataType, udtName),
			Required: isRequired,
			Default:  columnDefault,
		})
	}

	if len(fields) == 0 {
		return nil, fmt.Errorf("table not found or has no columns: %s", tableName)
	}

	return fields, nil
}

// GetTableDefinitionSQL returns a schema script for the selected table.
func (db *DB) GetTableDefinitionSQL(ctx context.Context, tableName string) (string, error) {
	if !IsValidIdentifier(tableName) {
		return "", fmt.Errorf("invalid table name: %s", tableName)
	}
	var ddl string
	err := db.Pool.QueryRow(ctx, `SELECT ozy_internal.get_table_ddl($1)`, tableName).Scan(&ddl)
	if err != nil {
		return "", fmt.Errorf("failed to get table DDL: %w", err)
	}
	return ddl, nil
}

// NormalizePostgresTypeToOzy converts PostgreSQL type metadata into OzyBase canonical type keys.
// pgType should be information_schema.columns.data_type (or equivalent).
// udtName is optional and used to disambiguate ARRAY element types.
func NormalizePostgresTypeToOzy(pgType string, udtName ...string) string {
	if len(udtName) == 0 {
		return mapPostgresTypeToOzyWithUDT(pgType, "")
	}
	return mapPostgresTypeToOzyWithUDT(pgType, udtName[0])
}

func mapPostgresArrayTypeToOzy(pgTypeUpper, udtNameUpper string) string {
	candidate := strings.TrimSpace(udtNameUpper)
	if candidate == "" {
		candidate = strings.TrimSpace(pgTypeUpper)
	}
	candidate = strings.TrimPrefix(candidate, "_")
	candidate = strings.ToUpper(candidate)

	switch {
	case strings.Contains(candidate, "INT2"), strings.Contains(candidate, "INT4"), strings.Contains(candidate, "INT8"),
		strings.Contains(candidate, "SMALLINT"), strings.Contains(candidate, "INTEGER"), strings.Contains(candidate, "BIGINT"):
		return "int_array"
	default:
		return "text_array"
	}
}

func mapPostgresTypeToOzyWithUDT(pgType string, udtName string) string {
	pgTypeUpper := strings.ToUpper(strings.TrimSpace(pgType))
	udtNameUpper := strings.ToUpper(strings.TrimSpace(udtName))

	switch {
	case pgTypeUpper == "SMALLINT" || pgTypeUpper == "INT2":
		return "int2"
	case pgTypeUpper == "INTEGER" || pgTypeUpper == "INT4":
		return "int4"
	case pgTypeUpper == "BIGINT" || pgTypeUpper == "INT8":
		return "int8"
	case strings.Contains(pgTypeUpper, "FLOAT4") || pgTypeUpper == "REAL":
		return "float4"
	case strings.Contains(pgTypeUpper, "FLOAT8") || pgTypeUpper == "DOUBLE PRECISION":
		return "float8"
	case strings.Contains(pgTypeUpper, "NUMERIC") || strings.Contains(pgTypeUpper, "DECIMAL"):
		return "numeric"
	case pgTypeUpper == "JSONB":
		return "jsonb"
	case pgTypeUpper == "JSON":
		return "json"
	case pgTypeUpper == "UUID":
		return "uuid"
	case pgTypeUpper == "DATE":
		return "date"
	case pgTypeUpper == "TIME WITH TIME ZONE" || strings.Contains(pgTypeUpper, "TIMETZ"):
		return "timetz"
	case pgTypeUpper == "TIME WITHOUT TIME ZONE" || pgTypeUpper == "TIME":
		return "time"
	case pgTypeUpper == "TIMESTAMP WITH TIME ZONE" || strings.Contains(pgTypeUpper, "TIMESTAMPTZ"):
		return "timestamptz"
	case pgTypeUpper == "TIMESTAMP WITHOUT TIME ZONE" || pgTypeUpper == "TIMESTAMP":
		return "timestamp"
	case pgTypeUpper == "BOOL" || pgTypeUpper == "BOOLEAN":
		return "bool"
	case strings.Contains(pgTypeUpper, "VARCHAR") || strings.Contains(pgTypeUpper, "CHARACTER VARYING"):
		return "varchar"
	case strings.Contains(pgTypeUpper, "TEXT"):
		return "text"
	case pgTypeUpper == "BYTEA":
		return "bytea"
	case pgTypeUpper == "INET":
		return "inet"
	case pgTypeUpper == "CIDR":
		return "cidr"
	case pgTypeUpper == "MACADDR":
		return "macaddr"
	case pgTypeUpper == "INTERVAL":
		return "interval"
	case pgTypeUpper == "MONEY":
		return "money"
	case pgTypeUpper == "ARRAY" || strings.Contains(pgTypeUpper, "[]"):
		return mapPostgresArrayTypeToOzy(pgTypeUpper, udtNameUpper)
	case strings.HasPrefix(udtNameUpper, "_"):
		return mapPostgresArrayTypeToOzy(pgTypeUpper, udtNameUpper)
	default:
		return "text"
	}
}

func mapPostgresTypeToOzy(pgType string) string {
	return mapPostgresTypeToOzyWithUDT(pgType, "")
}

// DatabaseSchema represents the full schema of the database
type DatabaseSchema struct {
	Tables        []TableDefinition   `json:"tables"`
	Relationships []TableRelationship `json:"relationships"`
}

type TableDefinition struct {
	Name     string        `json:"name"`
	IsSystem bool          `json:"is_system"`
	Columns  []FieldSchema `json:"columns"`
}

type TableRelationship struct {
	FromTable string `json:"from_table"`
	FromCol   string `json:"from_col"`
	ToTable   string `json:"to_table"`
	ToCol     string `json:"to_col"`
}

// GetDatabaseSchema fetches the full schema for visualization
func (db *DB) GetDatabaseSchema(ctx context.Context) (*DatabaseSchema, error) {
	// 1. Get all tables
	tables, err := db.ListTables(ctx)
	if err != nil {
		return nil, err
	}

	var schema DatabaseSchema

	// 2. Get columns for each table
	for _, tableName := range tables {
		rows, err := db.Pool.Query(ctx, `SELECT name, type, udt, nullable FROM ozy_internal.get_table_columns($1)`, tableName)
		if err != nil {
			continue // skip table on error
		}

		var cols []FieldSchema
		for rows.Next() {
			var colName, dataType, udtName string
			var nullable bool
			if err := rows.Scan(&colName, &dataType, &udtName, &nullable); err == nil {
				cols = append(cols, FieldSchema{
					Name:     colName,
					Type:     mapPostgresTypeToOzyWithUDT(dataType, udtName),
					Required: !nullable,
				})
			}
		}
		rows.Close()

		schema.Tables = append(schema.Tables, TableDefinition{
			Name:     tableName,
			IsSystem: strings.HasPrefix(tableName, "_v_") || strings.HasPrefix(tableName, "_ozy_"),
			Columns:  cols,
		})
	}

	// 3. Get relationships (Foreign Keys)
	rows, err := db.Pool.Query(ctx, `SELECT from_table, from_col, to_table, to_col FROM ozy_internal.get_all_foreign_keys()`)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch relationships: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var fromTable, fromCol, toTable, toCol string
		if err := rows.Scan(&fromTable, &fromCol, &toTable, &toCol); err == nil {
			schema.Relationships = append(schema.Relationships, TableRelationship{
				FromTable: fromTable,
				FromCol:   fromCol,
				ToTable:   toTable,
				ToCol:     toCol,
			})
		}
	}

	return &schema, nil
}

// AddColumn adds a new column to an existing table
func (db *DB) AddColumn(ctx context.Context, tableName string, field FieldSchema) (string, error) {
	if !IsValidIdentifier(tableName) || !IsValidIdentifier(field.Name) {
		return "", fmt.Errorf("invalid table or column name")
	}

	pgType, ok := TypeMapping[strings.ToLower(field.Type)]
	if !ok {
		return "", fmt.Errorf("unknown type: %s", field.Type)
	}

	// Use IF NOT EXISTS for resilience.
	// #nosec G201
	sql := fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS %s %s", QuoteIdentifier(tableName), QuoteIdentifier(field.Name), pgType)
	if field.Required {
		sql += " NOT NULL"
	}
	if field.Default != nil {
		sql += fmt.Sprintf(" DEFAULT %s", formatDefault(field.Default, field.Type))
	}

	_, err := db.Pool.Exec(ctx, sql)
	if err == nil {
		db.InvalidateTableColumnCache(tableName)
	} else {
		return sql, fmt.Errorf("failed to execute column expansion (%s): %w", sql, err)
	}
	return sql, nil
}

// UpdateColumn mutates an existing column definition in-place.
func (db *DB) UpdateColumn(ctx context.Context, tableName string, columnName string, opts UpdateColumnOptions) (string, error) {
	if !IsValidIdentifier(tableName) || !IsValidIdentifier(columnName) {
		return "", fmt.Errorf("invalid table or column name")
	}

	nextColumnName := columnName
	var statements []string

	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if strings.TrimSpace(opts.NextName) != "" && opts.NextName != columnName {
		if !IsValidIdentifier(opts.NextName) {
			return "", fmt.Errorf("invalid target column name")
		}
		renameSQL := fmt.Sprintf(
			"ALTER TABLE %s RENAME COLUMN %s TO %s",
			QuoteIdentifier(tableName),
			QuoteIdentifier(columnName),
			QuoteIdentifier(opts.NextName),
		)
		if _, err := tx.Exec(ctx, renameSQL); err != nil {
			return "", err
		}
		statements = append(statements, renameSQL)
		nextColumnName = opts.NextName
	}

	if strings.TrimSpace(opts.Type) != "" {
		pgType, ok := TypeMapping[strings.ToLower(opts.Type)]
		if !ok {
			return "", fmt.Errorf("unknown type: %s", opts.Type)
		}
		typeSQL := fmt.Sprintf(
			"ALTER TABLE %s ALTER COLUMN %s TYPE %s USING %s::%s",
			QuoteIdentifier(tableName),
			QuoteIdentifier(nextColumnName),
			pgType,
			QuoteIdentifier(nextColumnName),
			pgType,
		)
		if _, err := tx.Exec(ctx, typeSQL); err != nil {
			return "", err
		}
		statements = append(statements, typeSQL)
	}

	switch strings.ToLower(strings.TrimSpace(opts.DefaultMode)) {
	case "", "keep":
	case "set":
		defaultSQL := fmt.Sprintf(
			"ALTER TABLE %s ALTER COLUMN %s SET DEFAULT %s",
			QuoteIdentifier(tableName),
			QuoteIdentifier(nextColumnName),
			formatDefault(opts.Default, opts.Type),
		)
		if _, err := tx.Exec(ctx, defaultSQL); err != nil {
			return "", err
		}
		statements = append(statements, defaultSQL)
	case "drop":
		defaultSQL := fmt.Sprintf(
			"ALTER TABLE %s ALTER COLUMN %s DROP DEFAULT",
			QuoteIdentifier(tableName),
			QuoteIdentifier(nextColumnName),
		)
		if _, err := tx.Exec(ctx, defaultSQL); err != nil {
			return "", err
		}
		statements = append(statements, defaultSQL)
	default:
		return "", fmt.Errorf("invalid default mode")
	}

	if opts.Required != nil {
		requiredSQL := fmt.Sprintf(
			"ALTER TABLE %s ALTER COLUMN %s %s NOT NULL",
			QuoteIdentifier(tableName),
			QuoteIdentifier(nextColumnName),
			map[bool]string{true: "SET", false: "DROP"}[*opts.Required],
		)
		if _, err := tx.Exec(ctx, requiredSQL); err != nil {
			return "", err
		}
		statements = append(statements, requiredSQL)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	db.InvalidateTableColumnCache(tableName)
	return strings.Join(statements, ";\n"), nil
}

// SetTablePrimaryKey sets (or clears) the primary key definition for a table.
func (db *DB) SetTablePrimaryKey(ctx context.Context, tableName string, columns []string) (string, error) {
	if !IsValidIdentifier(tableName) {
		return "", fmt.Errorf("invalid table name: %s", tableName)
	}

	targetColumns, err := normalizeIdentifierList(columns)
	if err != nil {
		return "", err
	}

	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		SELECT tc.constraint_name, kcu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
		  ON tc.constraint_name = kcu.constraint_name
		 AND tc.table_schema = kcu.table_schema
		 AND tc.table_name = kcu.table_name
		WHERE tc.table_schema = 'public'
		  AND tc.table_name = $1
		  AND tc.constraint_type = 'PRIMARY KEY'
		ORDER BY kcu.ordinal_position
	`, tableName)
	if err != nil {
		return "", fmt.Errorf("failed to inspect existing primary key: %w", err)
	}
	defer rows.Close()

	existingConstraint := ""
	existingColumns := make([]string, 0, 2)
	for rows.Next() {
		var constraintName string
		var columnName string
		if err := rows.Scan(&constraintName, &columnName); err != nil {
			return "", fmt.Errorf("failed to read existing primary key: %w", err)
		}
		if existingConstraint == "" {
			existingConstraint = constraintName
		}
		existingColumns = append(existingColumns, columnName)
	}
	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("failed to inspect existing primary key: %w", err)
	}

	if existingConstraint != "" && equalIdentifierSlices(existingColumns, targetColumns) {
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		return "", nil
	}

	statements := make([]string, 0, 4)
	if existingConstraint != "" {
		dropSQL := fmt.Sprintf(
			"ALTER TABLE %s DROP CONSTRAINT %s",
			QuoteIdentifier(tableName),
			QuoteIdentifier(existingConstraint),
		)
		if _, err := tx.Exec(ctx, dropSQL); err != nil {
			return "", fmt.Errorf("failed to drop existing primary key: %w", err)
		}
		statements = append(statements, dropSQL)
	}

	if len(targetColumns) > 0 {
		var existingCount int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*)
			FROM ozy_internal.get_table_columns($1)
			WHERE name = ANY($2::text[])
		`, tableName, targetColumns).Scan(&existingCount); err != nil {
			return "", fmt.Errorf("failed to validate primary key columns: %w", err)
		}
		if existingCount != len(targetColumns) {
			return "", fmt.Errorf("one or more primary key columns do not exist")
		}

		for _, columnName := range targetColumns {
			setNotNullSQL := fmt.Sprintf(
				"ALTER TABLE %s ALTER COLUMN %s SET NOT NULL",
				QuoteIdentifier(tableName),
				QuoteIdentifier(columnName),
			)
			if _, err := tx.Exec(ctx, setNotNullSQL); err != nil {
				return "", fmt.Errorf("failed to mark %s as NOT NULL before primary key: %w", columnName, err)
			}
			statements = append(statements, setNotNullSQL)
		}

		quotedColumns := make([]string, 0, len(targetColumns))
		for _, columnName := range targetColumns {
			quotedColumns = append(quotedColumns, QuoteIdentifier(columnName))
		}
		addPrimarySQL := fmt.Sprintf(
			"ALTER TABLE %s ADD PRIMARY KEY (%s)",
			QuoteIdentifier(tableName),
			strings.Join(quotedColumns, ", "),
		)
		if _, err := tx.Exec(ctx, addPrimarySQL); err != nil {
			return "", fmt.Errorf("failed to add primary key: %w", err)
		}
		statements = append(statements, addPrimarySQL)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	db.InvalidateTableColumnCache(tableName)
	return strings.Join(statements, ";\n"), nil
}

// DeleteColumn removes a column from an existing table
func (db *DB) DeleteColumn(ctx context.Context, tableName string, columnName string) (string, error) {
	if !IsValidIdentifier(tableName) || !IsValidIdentifier(columnName) {
		return "", fmt.Errorf("invalid table or column name")
	}

	// #nosec G201
	sql := fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", QuoteIdentifier(tableName), QuoteIdentifier(columnName))
	_, err := db.Pool.Exec(ctx, sql)
	if err == nil {
		db.InvalidateTableColumnCache(tableName)
	}
	return sql, err
}

// DeleteTable drops an existing table
func (db *DB) DeleteTable(ctx context.Context, tableName string) error {
	if !IsValidIdentifier(tableName) {
		return fmt.Errorf("invalid table name: %s", tableName)
	}

	// #nosec G201
	sql := fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE", QuoteIdentifier(tableName))
	_, err := db.Pool.Exec(ctx, sql)
	if err == nil {
		db.InvalidateTableColumnCache(tableName)
	}
	return err
}

// EnableRLS enables Row Level Security on a table
func (db *DB) EnableRLS(ctx context.Context, tx pgx.Tx, tableName string) error {
	if !IsValidIdentifier(tableName) {
		return fmt.Errorf("invalid table name")
	}
	// #nosec G201
	_, err := tx.Exec(ctx, fmt.Sprintf("ALTER TABLE %s ENABLE ROW LEVEL SECURITY", QuoteIdentifier(tableName)))
	return err
}

// SetRLSForce toggles FORCE ROW LEVEL SECURITY on a table.
func (db *DB) SetRLSForce(ctx context.Context, tx pgx.Tx, tableName string, force bool) error {
	if !IsValidIdentifier(tableName) {
		return fmt.Errorf("invalid table name")
	}
	clause := "NO FORCE"
	if force {
		clause = "FORCE"
	}
	// #nosec G201
	_, err := tx.Exec(ctx, fmt.Sprintf("ALTER TABLE %s %s ROW LEVEL SECURITY", QuoteIdentifier(tableName), clause))
	return err
}

// DisableRLS disables Row Level Security on a table.
func (db *DB) DisableRLS(ctx context.Context, tx pgx.Tx, tableName string) error {
	if !IsValidIdentifier(tableName) {
		return fmt.Errorf("invalid table name")
	}
	// #nosec G201
	_, err := tx.Exec(ctx, fmt.Sprintf("ALTER TABLE %s DISABLE ROW LEVEL SECURITY", QuoteIdentifier(tableName)))
	return err
}

// CreatePolicy creates a simple RLS policy.
// For now, it target the 'auth.uid() = [column]' pattern.
func (db *DB) CreatePolicy(ctx context.Context, tx pgx.Tx, tableName, policyName, rule string) error {
	return db.CreatePolicyForAction(ctx, tx, tableName, policyName, "all", rule, nil)
}

// CreatePolicyForAction creates an RLS policy for a specific action.
// Supported actions: select, insert, update, delete, all.
func (db *DB) CreatePolicyForAction(ctx context.Context, tx pgx.Tx, tableName, policyName, action, rule string, roles []string) error {
	if !IsValidIdentifier(tableName) || !IsValidIdentifier(policyName) {
		return fmt.Errorf("invalid identifiers")
	}

	normalizedRoles := make([]string, 0, len(roles))
	seen := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		candidate := strings.ToLower(strings.TrimSpace(role))
		if candidate == "" {
			continue
		}
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		switch candidate {
		case "public":
			normalizedRoles = append(normalizedRoles, "PUBLIC")
		default:
			normalizedRoles = append(normalizedRoles, QuoteIdentifier(candidate))
		}
	}

	toClause := ""
	if len(normalizedRoles) > 0 {
		toClause = " TO " + strings.Join(normalizedRoles, ", ")
	}

	act := strings.ToLower(strings.TrimSpace(action))
	var sql string
	switch act {
	case "select":
		// #nosec G201
		sql = fmt.Sprintf("CREATE POLICY %s ON %s FOR SELECT%s USING (%s)", QuoteIdentifier(policyName), QuoteIdentifier(tableName), toClause, rule)
	case "insert":
		// #nosec G201
		sql = fmt.Sprintf("CREATE POLICY %s ON %s FOR INSERT%s WITH CHECK (%s)", QuoteIdentifier(policyName), QuoteIdentifier(tableName), toClause, rule)
	case "update":
		// #nosec G201
		sql = fmt.Sprintf("CREATE POLICY %s ON %s FOR UPDATE%s USING (%s) WITH CHECK (%s)", QuoteIdentifier(policyName), QuoteIdentifier(tableName), toClause, rule, rule)
	case "delete":
		// #nosec G201
		sql = fmt.Sprintf("CREATE POLICY %s ON %s FOR DELETE%s USING (%s)", QuoteIdentifier(policyName), QuoteIdentifier(tableName), toClause, rule)
	case "all":
		// #nosec G201
		sql = fmt.Sprintf("CREATE POLICY %s ON %s FOR ALL%s USING (%s)", QuoteIdentifier(policyName), QuoteIdentifier(tableName), toClause, rule)
	default:
		return fmt.Errorf("invalid policy action: %s", action)
	}

	_, err := tx.Exec(ctx, sql)
	return err
}
