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
	if !IsValidIdentifier(collectionName) {
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
		if !IsValidIdentifier(col) {
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
	if !IsValidIdentifier(collectionName) {
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

		if IsValidIdentifier(col) {
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

// GetRecord fetches a single record by ID
func (db *DB) GetRecord(ctx context.Context, collectionName, id string) (map[string]interface{}, error) {
	if !IsValidIdentifier(collectionName) {
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

// UpdateRecord updates an existing record in a dynamic collection table
func (db *DB) UpdateRecord(ctx context.Context, collectionName, id string, data map[string]interface{}) error {
	if !IsValidIdentifier(collectionName) {
		return fmt.Errorf("invalid collection name: %s", collectionName)
	}

	if len(data) == 0 {
		return nil // Nothing to update
	}

	var updates []string
	var values []interface{}
	i := 1

	for col, val := range data {
		if !IsValidIdentifier(col) {
			return fmt.Errorf("invalid column name: %s", col)
		}

		// Skip system columns
		if col == "id" || col == "created_at" || col == "updated_at" {
			continue
		}

		updates = append(updates, fmt.Sprintf("%s = $%d", col, i))
		values = append(values, val)
		i++
	}

	if len(updates) == 0 {
		return nil
	}

	// Add updated_at if it exists
	updates = append(updates, "updated_at = NOW()")

	query := fmt.Sprintf(
		"UPDATE %s SET %s WHERE id = $%d",
		collectionName,
		strings.Join(updates, ", "),
		i,
	)
	values = append(values, id)

	_, err := db.Pool.Exec(ctx, query, values...)
	if err != nil {
		return fmt.Errorf("database error: %v", err)
	}

	return nil
}

// DeleteRecord removes a record from a dynamic collection table
func (db *DB) DeleteRecord(ctx context.Context, collectionName, id string) error {
	if !IsValidIdentifier(collectionName) {
		return fmt.Errorf("invalid collection name: %s", collectionName)
	}

	query := fmt.Sprintf("DELETE FROM %s WHERE id = $1", collectionName)
	_, err := db.Pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("database error: %v", err)
	}

	return nil
}

// BulkInsertRecord inserts multiple records in a single transaction
func (db *DB) BulkInsertRecord(ctx context.Context, collectionName string, records []map[string]interface{}) error {
	if !IsValidIdentifier(collectionName) {
		return fmt.Errorf("invalid collection name: %s", collectionName)
	}

	if len(records) == 0 {
		return nil
	}

	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, data := range records {
		var columns []string
		var placeholders []string
		var values []interface{}
		i := 1

		for col, val := range data {
			if !IsValidIdentifier(col) {
				continue
			}
			if col == "id" || col == "created_at" || col == "updated_at" {
				continue
			}

			columns = append(columns, col)
			placeholders = append(placeholders, fmt.Sprintf("$%d", i))
			values = append(values, val)
			i++
		}

		if len(columns) == 0 {
			continue
		}

		query := fmt.Sprintf(
			"INSERT INTO %s (%s) VALUES (%s)",
			collectionName,
			strings.Join(columns, ", "),
			strings.Join(placeholders, ", "),
		)

		if _, err := tx.Exec(ctx, query, values...); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}
