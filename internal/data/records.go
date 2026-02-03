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
		if col == "id" || col == "created_at" || col == "updated_at" || col == "deleted_at" {
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

// ListRecords fetches all records from a dynamic collection table with filters and sorting
func (db *DB) ListRecords(ctx context.Context, collectionName string, filters map[string][]string, orderBy string) ([]map[string]interface{}, error) {
	if !IsValidIdentifier(collectionName) {
		return nil, fmt.Errorf("invalid collection name: %s", collectionName)
	}

	// Default to filtering out soft-deleted records
	whereClauses := []string{"deleted_at IS NULL"}
	var queryArgs []interface{}
	argIdx := 1

	// Parse filters (e.g., price=gt.100)
	for col, values := range filters {
		if col == "order" || col == "select" || col == "limit" || col == "offset" {
			continue // Reserved keywords
		}

		if !IsValidIdentifier(col) {
			continue
		}

		for _, valStr := range values {
			parts := strings.SplitN(valStr, ".", 2)
			op := "eq"
			val := valStr
			if len(parts) == 2 {
				op = parts[0]
				val = parts[1]
			}

			var sqlOp string
			switch op {
			case "eq":
				sqlOp = "="
			case "neq":
				sqlOp = "!="
			case "gt":
				sqlOp = ">"
			case "gte":
				sqlOp = ">="
			case "lt":
				sqlOp = "<"
			case "lte":
				sqlOp = "<="
			case "like":
				sqlOp = "ILIKE"
				val = "%" + val + "%"
			case "is":
				if strings.ToLower(val) == "null" {
					whereClauses = append(whereClauses, fmt.Sprintf("%s IS NULL", col))
					continue
				}
			default:
				sqlOp = "="
			}

			if sqlOp != "" {
				whereClauses = append(whereClauses, fmt.Sprintf("%s %s $%d", col, sqlOp, argIdx))
				queryArgs = append(queryArgs, val)
				argIdx++
			}
		}
	}

	// Handle Select
	selectCols := "*"
	if sel, ok := filters["select"]; ok && len(sel) > 0 {
		cols := strings.Split(sel[0], ",")
		var validCols []string
		for _, c := range cols {
			c = strings.TrimSpace(c)
			if IsValidIdentifier(c) {
				validCols = append(validCols, c)
			}
		}
		if len(validCols) > 0 {
			selectCols = strings.Join(validCols, ", ")
		}
	}

	query := fmt.Sprintf("SELECT %s FROM %s WHERE %s", selectCols, collectionName, strings.Join(whereClauses, " AND "))

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

	// Handle Limit/Offset
	if l, ok := filters["limit"]; ok && len(l) > 0 {
		query += fmt.Sprintf(" LIMIT %s", l[0]) // Basic protection: pgx will fail if not number
	}
	if o, ok := filters["offset"]; ok && len(o) > 0 {
		query += fmt.Sprintf(" OFFSET %s", o[0])
	}

	rows, err := db.Pool.Query(ctx, query, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("failed to query records: %w", err)
	}
	defer rows.Close()

	return rowsToMaps(rows)
}

// GetRecord fetches a single record by ID, optionally filtered by owner
func (db *DB) GetRecord(ctx context.Context, collectionName, id string, ownerField, ownerID string) (map[string]interface{}, error) {
	if !IsValidIdentifier(collectionName) {
		return nil, fmt.Errorf("invalid collection name: %s", collectionName)
	}

	query := fmt.Sprintf("SELECT * FROM %s WHERE id = $1 AND deleted_at IS NULL", collectionName)
	var args []interface{}
	args = append(args, id)

	if ownerField != "" && ownerID != "" && IsValidIdentifier(ownerField) {
		query += fmt.Sprintf(" AND %s = $2", ownerField)
		args = append(args, ownerID)
	}

	rows, err := db.Pool.Query(ctx, query, args...)
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

// UpdateRecord updates an existing record, optionally filtered by owner
func (db *DB) UpdateRecord(ctx context.Context, collectionName, id string, data map[string]interface{}, ownerField, ownerID string) error {
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

	whereClause := fmt.Sprintf("WHERE id = $%d", i)
	values = append(values, id)
	i++

	if ownerField != "" && ownerID != "" && IsValidIdentifier(ownerField) {
		whereClause += fmt.Sprintf(" AND %s = $%d", ownerField, i)
		values = append(values, ownerID)
	}

	query := fmt.Sprintf(
		"UPDATE %s SET %s %s",
		collectionName,
		strings.Join(updates, ", "),
		whereClause,
	)

	_, err := db.Pool.Exec(ctx, query, values...)
	if err != nil {
		return fmt.Errorf("database error: %v", err)
	}

	return nil
}

// DeleteRecord performs a soft-delete, optionally filtered by owner
func (db *DB) DeleteRecord(ctx context.Context, collectionName, id string, ownerField, ownerID string) error {
	if !IsValidIdentifier(collectionName) {
		return fmt.Errorf("invalid collection name: %s", collectionName)
	}

	var args []interface{}
	args = append(args, id)
	ownerCondition := ""
	if ownerField != "" && ownerID != "" && IsValidIdentifier(ownerField) {
		ownerCondition = fmt.Sprintf(" AND %s = $2", ownerField)
		args = append(args, ownerID)
	}

	// For system tables (starting with _), we do hard delete for now
	if strings.HasPrefix(collectionName, "_v_") {
		query := fmt.Sprintf("DELETE FROM %s WHERE id = $1%s", collectionName, ownerCondition)
		_, err := db.Pool.Exec(ctx, query, args...)
		return err
	}

	query := fmt.Sprintf("UPDATE %s SET deleted_at = NOW() WHERE id = $1%s", collectionName, ownerCondition)
	_, err := db.Pool.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("database error: %v", err)
	}

	return nil
}

// HardDeleteRecord permanently removes a record
func (db *DB) HardDeleteRecord(ctx context.Context, collectionName, id string) error {
	if !IsValidIdentifier(collectionName) {
		return fmt.Errorf("invalid collection name: %s", collectionName)
	}

	query := fmt.Sprintf("DELETE FROM %s WHERE id = $1", collectionName)
	_, err := db.Pool.Exec(ctx, query, id)
	return err
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
			if col == "id" || col == "created_at" || col == "updated_at" || col == "deleted_at" {
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
