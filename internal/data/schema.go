package data

import (
	"context"
	"fmt"
	"strings"
)

// FieldSchema represents a single field in a collection schema
type FieldSchema struct {
	Name     string      `json:"name"`
	Type     string      `json:"type"`
	Required bool        `json:"required,omitempty"`
	Default  interface{} `json:"default,omitempty"`
}

// TypeMapping maps OzyBase types to PostgreSQL types
var TypeMapping = map[string]string{
	"text":     "TEXT",
	"number":   "NUMERIC",
	"boolean":  "BOOLEAN",
	"datetime": "TIMESTAMPTZ",
	"json":     "JSONB",
	"uuid":     "UUID",
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
	if !isValidIdentifier(tableName) {
		return "", fmt.Errorf("invalid table name: %s", tableName)
	}

	var columns []string

	// Always add id as primary key
	columns = append(columns, "id UUID PRIMARY KEY DEFAULT gen_random_uuid()")

	for _, field := range schema {
		if !isValidIdentifier(field.Name) {
			return "", fmt.Errorf("invalid field name: %s", field.Name)
		}

		pgType, ok := TypeMapping[strings.ToLower(field.Type)]
		if !ok {
			return "", fmt.Errorf("unknown type: %s", field.Type)
		}

		col := fmt.Sprintf("%s %s", field.Name, pgType)

		if field.Required {
			col += " NOT NULL"
		}

		if field.Default != nil {
			col += fmt.Sprintf(" DEFAULT %s", formatDefault(field.Default, field.Type))
		}

		columns = append(columns, col)
	}

	// Always add timestamps
	columns = append(columns, "created_at TIMESTAMPTZ DEFAULT NOW()")
	columns = append(columns, "updated_at TIMESTAMPTZ DEFAULT NOW()")

	sql := fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (\n\t%s\n)",
		tableName,
		strings.Join(columns, ",\n\t"))

	return sql, nil
}

// isValidIdentifier checks if a string is a valid SQL identifier
func isValidIdentifier(name string) bool {
	if len(name) == 0 || len(name) > 63 {
		return false
	}

	// Must start with letter or underscore
	first := name[0]
	if !((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z') || first == '_') {
		return false
	}

	// Rest can be letters, digits, or underscores
	for _, c := range name[1:] {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}

	return true
}

// formatDefault formats a default value for SQL
func formatDefault(value interface{}, fieldType string) string {
	switch v := value.(type) {
	case bool:
		if v {
			return "TRUE"
		}
		return "FALSE"
	case string:
		return fmt.Sprintf("'%s'", strings.ReplaceAll(v, "'", "''"))
	case float64, int:
		return fmt.Sprintf("%v", v)
	default:
		return fmt.Sprintf("'%v'", v)
	}
}

// GetTableSchema fetches the schema of a table from information_schema
func (db *DB) GetTableSchema(ctx context.Context, tableName string) ([]FieldSchema, error) {
	if !isValidIdentifier(tableName) {
		return nil, fmt.Errorf("invalid table name: %s", tableName)
	}

	query := `
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_name = $1
		  AND table_schema = 'public'
		ORDER BY ordinal_position
	`

	rows, err := db.Pool.Query(ctx, query, tableName)
	if err != nil {
		return nil, fmt.Errorf("failed to query table schema: %w", err)
	}
	defer rows.Close()

	var schema []FieldSchema
	for rows.Next() {
		var colName, dataType, isNullable string

		if err := rows.Scan(&colName, &dataType, &isNullable); err != nil {
			return nil, fmt.Errorf("failed to scan column schema: %w", err)
		}

		// Skip internal columns as they are standard across OzyBase tables
		if colName == "id" || colName == "created_at" || colName == "updated_at" {
			continue
		}

		schema = append(schema, FieldSchema{
			Name:     colName,
			Type:     mapPostgresTypeToOzy(dataType),
			Required: isNullable == "NO",
		})
	}

	if len(schema) == 0 {
		return nil, fmt.Errorf("table not found or has no columns: %s", tableName)
	}

	return schema, nil
}

func mapPostgresTypeToOzy(pgType string) string {
	pgType = strings.ToUpper(pgType)
	switch {
	case strings.Contains(pgType, "TEXT") || strings.Contains(pgType, "VARCHAR") || strings.Contains(pgType, "CHARACTER"):
		return "text"
	case strings.Contains(pgType, "NUMERIC") || strings.Contains(pgType, "INT") || strings.Contains(pgType, "DOUBLE") || strings.Contains(pgType, "PRECISION"):
		return "number"
	case strings.Contains(pgType, "BOOL"):
		return "boolean"
	case strings.Contains(pgType, "TIMESTAMP"):
		return "datetime"
	case strings.Contains(pgType, "JSON"):
		return "json"
	case strings.Contains(pgType, "UUID"):
		return "uuid"
	default:
		return "text"
	}
}
