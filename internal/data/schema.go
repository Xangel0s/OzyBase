package data

import (
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

