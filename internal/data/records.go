package data

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// InsertRecord inserts a record into a dynamic collection table
func (db *DB) InsertRecord(ctx context.Context, collectionName string, data map[string]any) (string, error) {
	if !IsValidIdentifier(collectionName) {
		return "", fmt.Errorf("invalid collection name: %s", collectionName)
	}

	var id string
	err := db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		var columns []string
		var placeholders []string
		var values []any
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

		query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) RETURNING id",
			collectionName, strings.Join(columns, ", "), strings.Join(placeholders, ", "))

		return tx.QueryRow(ctx, query, values...).Scan(&id)
	})

	return id, err
}

// ListRecords fetches all records with filters and sorting, respecting RLS if configured in DB
func (db *DB) ListRecords(ctx context.Context, collectionName string, filters map[string][]string, orderBy string) ([]map[string]any, error) {
	if !IsValidIdentifier(collectionName) {
		return nil, fmt.Errorf("invalid collection name: %s", collectionName)
	}

	var results []map[string]any
	err := db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		whereClauses := []string{"deleted_at IS NULL"}
		var queryArgs []any
		argIdx := 1

		for col, values := range filters {
			if col == "order" || col == "select" || col == "limit" || col == "offset" {
				continue
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

				sqlOp := "="
				switch op {
				case "gt":
					sqlOp = ">"
				case "gte":
					sqlOp = ">="
				case "lt":
					sqlOp = "<"
				case "lte":
					sqlOp = "<="
				case "neq":
					sqlOp = "!="
				case "like":
					sqlOp = "ILIKE"
					val = "%" + val + "%"
				}

				whereClauses = append(whereClauses, fmt.Sprintf("%s %s $%d", col, sqlOp, argIdx))
				queryArgs = append(queryArgs, val)
				argIdx++
			}
		}

		query := fmt.Sprintf("SELECT * FROM %s WHERE %s", collectionName, strings.Join(whereClauses, " AND "))

		if orderBy != "" {
			// Basic sanitization: only allow alphanumeric and underscores
			if IsValidIdentifier(strings.ReplaceAll(orderBy, ".", "")) {
				query += " ORDER BY " + strings.ReplaceAll(orderBy, ".", " ")
			} else {
				query += " ORDER BY created_at DESC"
			}
		} else {
			query += " ORDER BY created_at DESC"
		}

		rows, err := tx.Query(ctx, query, queryArgs...)
		if err != nil {
			return err
		}
		defer rows.Close()

		results, err = rowsToMaps(rows)
		return err
	})

	return results, err
}

// GetRecord fetches a single record, respecting RLS
func (db *DB) GetRecord(ctx context.Context, collectionName, id string, ownerField, ownerID string) (map[string]any, error) {
	var record map[string]any
	err := db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		query := fmt.Sprintf("SELECT * FROM %s WHERE id = $1 AND deleted_at IS NULL", collectionName)
		rows, err := tx.Query(ctx, query, id)
		if err != nil {
			return err
		}
		defer rows.Close()

		records, err := rowsToMaps(rows)
		if err != nil {
			return err
		}
		if len(records) == 0 {
			return fmt.Errorf("record not found")
		}
		record = records[0]
		return nil
	})
	return record, err
}

// UpdateRecord updates a record, respecting RLS
func (db *DB) UpdateRecord(ctx context.Context, collectionName, id string, data map[string]any, ownerField, ownerID string) error {
	return db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		var updates []string
		var values []any
		i := 1

		for col, val := range data {
			if !IsValidIdentifier(col) {
				continue
			}
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

		query := fmt.Sprintf("UPDATE %s SET %s, updated_at = NOW() WHERE id = $%d",
			collectionName, strings.Join(updates, ", "), i)
		values = append(values, id)

		_, err := tx.Exec(ctx, query, values...)
		return err
	})
}

// DeleteRecord soft-deletes a record, respecting RLS
func (db *DB) DeleteRecord(ctx context.Context, collectionName, id string, ownerField, ownerID string) error {
	return db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		query := fmt.Sprintf("UPDATE %s SET deleted_at = NOW() WHERE id = $1", collectionName)
		_, err := tx.Exec(ctx, query, id)
		return err
	})
}

func rowsToMaps(rows pgx.Rows) ([]map[string]any, error) {
	fieldDescriptions := rows.FieldDescriptions()
	var results []map[string]any

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}

		record := make(map[string]any)
		for i, fd := range fieldDescriptions {
			record[string(fd.Name)] = values[i]
		}
		results = append(results, record)
	}

	return results, rows.Err()
}

// BulkInsertRecord inserts multiple records
func (db *DB) BulkInsertRecord(ctx context.Context, collectionName string, records []map[string]any) error {
	return db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		for _, data := range records {
			var columns []string
			var placeholders []string
			var values []any
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
			query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
				collectionName, strings.Join(columns, ", "), strings.Join(placeholders, ", "))
			_, err := tx.Exec(ctx, query, values...)
			if err != nil {
				return err
			}
		}
		return nil
	})
}
