package data

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// InsertRecord inserts a record into a dynamic collection table
// Returns the new record ID
func (db *DB) InsertRecord(ctx context.Context, collectionName string, data map[string]interface{}) (string, error) {
	if !isValidIdentifier(collectionName) {
		return "", fmt.Errorf("invalid collection name: %s", collectionName)
	}

	if len(data) == 0 {
		return "", fmt.Errorf("data cannot be empty")
	}

	// Build column names and placeholders
	var columns []string
	var placeholders []string
	var values []interface{}
	i := 1

	for col, val := range data {
		if !isValidIdentifier(col) {
			return "", fmt.Errorf("invalid column name: %s", col)
		}

		// Skip standard generated columns if provided
		if col == "id" || col == "created_at" || col == "updated_at" {
			continue
		}

		columns = append(columns, col)
		placeholders = append(placeholders, fmt.Sprintf("$%d", i))

		// Refine value (handle date strings, etc.)
		sanitizedVal := val
		if str, ok := val.(string); ok && str == "" {
			sanitizedVal = nil
		}

		values = append(values, sanitizedVal)
		i++
	}

	if len(columns) == 0 {
		return "", fmt.Errorf("no valid data columns provided")
	}

	query := fmt.Sprintf(
		"INSERT INTO %s (%s) VALUES (%s) RETURNING id",
		collectionName,
		strings.Join(columns, ", "),
		strings.Join(placeholders, ", "),
	)

	var id string
	err := db.Pool.QueryRow(ctx, query, values...).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("database error: %v", err)
	}

	return id, nil
}

// ListRecords fetches all records from a dynamic collection table
func (db *DB) ListRecords(ctx context.Context, collectionName string, orderBy string) ([]map[string]interface{}, error) {
	if !isValidIdentifier(collectionName) {
		return nil, fmt.Errorf("invalid collection name: %s", collectionName)
	}

	query := fmt.Sprintf("SELECT * FROM %s", collectionName)

	// Add ordering if provided and valid
	if orderBy != "" {
		parts := strings.Split(orderBy, ".")
		col := parts[0]
		dir := "ASC"
		if len(parts) > 1 && strings.ToUpper(parts[1]) == "DESC" {
			dir = "DESC"
		}

		if isValidIdentifier(col) {
			query += fmt.Sprintf(" ORDER BY %s %s", col, dir)
		} else {
			query += " ORDER BY created_at DESC"
		}
	} else {
		query += " ORDER BY created_at DESC"
	}

	rows, err := db.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query records: %w", err)
	}
	defer rows.Close()

	return rowsToMaps(rows)
}

// ListTables returns a list of all user-defined tables in the public schema
func (db *DB) ListTables(ctx context.Context) ([]string, error) {
	query := `
		SELECT table_name 
		FROM information_schema.tables 
		WHERE table_schema = 'public' 
		  AND table_type = 'BASE TABLE'
		  AND table_name NOT LIKE '\_v\_%'
		ORDER BY table_name
	`

	rows, err := db.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list tables: %w", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, name)
	}

	return tables, nil
}

// GetRecord fetches a single record by ID
func (db *DB) GetRecord(ctx context.Context, collectionName, id string) (map[string]interface{}, error) {
	if !isValidIdentifier(collectionName) {
		return nil, fmt.Errorf("invalid collection name: %s", collectionName)
	}

	query := fmt.Sprintf("SELECT * FROM %s WHERE id = $1", collectionName)

	rows, err := db.Pool.Query(ctx, query, id)
	if err != nil {
		return nil, fmt.Errorf("failed to query record: %w", err)
	}
	defer rows.Close()

	records, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}

	if len(records) == 0 {
		return nil, fmt.Errorf("record not found")
	}

	return records[0], nil
}

// rowsToMaps converts pgx.Rows to a slice of maps
func rowsToMaps(rows pgx.Rows) ([]map[string]interface{}, error) {
	fieldDescriptions := rows.FieldDescriptions()
	var results []map[string]interface{}

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}

		record := make(map[string]interface{})
		for i, fd := range fieldDescriptions {
			record[string(fd.Name)] = values[i]
		}
		results = append(results, record)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("row iteration error: %w", err)
	}

	return results, nil
}
