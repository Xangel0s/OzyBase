package data

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

var ErrRecordNotFound = errors.New("record not found")

const maxBulkImportRowErrors = 25

func (db *DB) resolveRowIdentityColumn(ctx context.Context, collectionName string) (string, error) {
	if db.HasColumn(ctx, collectionName, "id") {
		return "id", nil
	}

	primaryColumn, err := db.GetSinglePrimaryKeyColumn(ctx, collectionName)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "composite primary key") {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(primaryColumn), nil
}

type BulkImportRowError struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

type BulkImportError struct {
	Summary   string               `json:"summary"`
	RowErrors []BulkImportRowError `json:"row_errors,omitempty"`
	Truncated bool                 `json:"truncated,omitempty"`
}

func (e *BulkImportError) Error() string {
	if e == nil {
		return ""
	}
	return e.Summary
}

type bulkImportDiagnosticCollector struct {
	maxErrors int
	rowErrors []BulkImportRowError
	truncated bool
}

func newBulkImportDiagnosticCollector(maxErrors int) *bulkImportDiagnosticCollector {
	if maxErrors < 1 {
		maxErrors = 1
	}
	return &bulkImportDiagnosticCollector{
		maxErrors: maxErrors,
		rowErrors: make([]BulkImportRowError, 0, maxErrors),
	}
}

func (c *bulkImportDiagnosticCollector) exhausted() bool {
	return len(c.rowErrors) >= c.maxErrors
}

func (c *bulkImportDiagnosticCollector) addRowError(row int, err error) {
	if c.exhausted() {
		c.truncated = true
		return
	}

	c.rowErrors = append(c.rowErrors, BulkImportRowError{
		Row:     row,
		Message: sanitizeBulkImportRowMessage(err),
	})
}

func (c *bulkImportDiagnosticCollector) toError() *BulkImportError {
	if len(c.rowErrors) == 0 {
		return nil
	}

	summary := fmt.Sprintf("Import aborted after finding %d invalid row(s). Fix the highlighted rows and try again.", len(c.rowErrors))
	if c.truncated {
		summary = fmt.Sprintf("Import aborted after finding at least %d invalid row(s). Fix the highlighted rows and try again.", len(c.rowErrors))
	}

	return &BulkImportError{
		Summary:   summary,
		RowErrors: append([]BulkImportRowError(nil), c.rowErrors...),
		Truncated: c.truncated,
	}
}

func sanitizeBulkImportRowMessage(err error) string {
	if err == nil {
		return "failed validation"
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23502":
			return "missing a required value"
		case "23503":
			return "references a missing related record"
		case "23505":
			return "duplicates a value that must be unique"
		case "22003", "22007", "22008", "22P02", "42804":
			return "contains a value with an invalid type or format"
		default:
			return "failed database validation"
		}
	}

	message := strings.TrimSpace(err.Error())
	lower := strings.ToLower(message)

	if index := strings.Index(lower, "expected "); index >= 0 {
		return message[index:]
	}

	switch {
	case strings.Contains(lower, "violates not-null constraint"):
		return "missing a required value"
	case strings.Contains(lower, "violates foreign key constraint"):
		return "references a missing related record"
	case strings.Contains(lower, "violates unique constraint"):
		return "duplicates a value that must be unique"
	case strings.Contains(lower, "invalid input syntax"):
		return "contains a value with an invalid type or format"
	default:
		return "failed validation"
	}
}

// InsertRecord inserts a record into a dynamic collection table
func (db *DB) InsertRecord(ctx context.Context, collectionName string, data map[string]any) (string, error) {
	if !IsValidIdentifier(collectionName) {
		return "", fmt.Errorf("invalid collection name: %s", collectionName)
	}

	identityColumn, err := db.resolveRowIdentityColumn(ctx, collectionName)
	if err != nil {
		return "", err
	}

	// 🔐 Security: Global auto-hash for sensitive fields
	autoHashSensitiveData(data)

	var id string
	err = db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
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

		quotedColumns := make([]string, 0, len(columns))
		for _, column := range columns {
			quotedColumns = append(quotedColumns, QuoteIdentifier(column))
		}

		query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
			QuoteIdentifier(collectionName), strings.Join(quotedColumns, ", "), strings.Join(placeholders, ", "))

		if identityColumn != "" {
			query += fmt.Sprintf(" RETURNING %s::text", QuoteIdentifier(identityColumn))
			return tx.QueryRow(ctx, query, values...).Scan(&id)
		}
		_, err := tx.Exec(ctx, query, values...)
		return err
	})

	return id, err
}

// ListRecordsResult encapsulates the output of a paginated list operation
type ListRecordsResult struct {
	Data       []map[string]any
	Total      int64
	HasMore    bool
	TotalExact bool
}

type recordCountMode string

const (
	recordCountExact    recordCountMode = "exact"
	recordCountDeferred recordCountMode = "deferred"
	recordCountAuto     recordCountMode = "auto"
)

func isSearchableRecordColumnType(dataType string) bool {
	switch strings.ToLower(strings.TrimSpace(dataType)) {
	case "text", "character varying", "varchar", "character", "char", "uuid", "citext":
		return true
	default:
		return false
	}
}

func recordSearchExpressionColumns(columnTypes map[string]string) []string {
	searchableColumns := make([]string, 0, len(columnTypes))
	for columnName, dataType := range columnTypes {
		if !IsValidIdentifier(columnName) {
			continue
		}
		if columnName == "deleted_at" {
			continue
		}
		if columnName == "id" || isSearchableRecordColumnType(dataType) {
			searchableColumns = append(searchableColumns, columnName)
		}
	}
	sort.Strings(searchableColumns)
	return searchableColumns
}

func isTextSearchIndexedRecordColumnType(dataType string) bool {
	switch strings.ToLower(strings.TrimSpace(dataType)) {
	case "text", "character varying", "varchar", "character", "char", "citext":
		return true
	default:
		return false
	}
}

func BuildRecordSearchExpression(columnTypes map[string]string) string {
	searchableColumns := recordSearchExpressionColumns(columnTypes)
	searchExprParts := make([]string, 0, len(searchableColumns))
	for _, columnName := range searchableColumns {
		if columnName == "id" || !isTextSearchIndexedRecordColumnType(columnTypes[columnName]) {
			continue
		}
		searchExprParts = append(searchExprParts, fmt.Sprintf("COALESCE(%s::text, '')", QuoteIdentifier(columnName)))
	}

	if len(searchExprParts) == 0 {
		return ""
	}

	searchExpression := searchExprParts[0]
	for _, part := range searchExprParts[1:] {
		searchExpression += " || ' ' || " + part
	}

	return "LOWER(" + searchExpression + ")"
}

func recordSearchIndexName(tableName string) string {
	base := fmt.Sprintf("idx_%s_search_trgm", strings.ToLower(strings.TrimSpace(tableName)))
	if len(base) <= 63 {
		return base
	}

	const suffix = "_search_trgm"
	maxPrefixLen := 63 - len(suffix)
	if maxPrefixLen < 1 {
		maxPrefixLen = 1
	}
	prefix := fmt.Sprintf("idx_%s", strings.ToLower(strings.TrimSpace(tableName)))
	if len(prefix) > maxPrefixLen {
		prefix = prefix[:maxPrefixLen]
	}
	return prefix + suffix
}

func BuildRecordSearchIndexSQL(tableName string, columnTypes map[string]string) string {
	if !IsValidIdentifier(tableName) {
		return ""
	}

	searchExpression := BuildRecordSearchExpression(columnTypes)
	if searchExpression == "" {
		return ""
	}

	return fmt.Sprintf(
		"CREATE INDEX IF NOT EXISTS %s ON %s USING GIN ((%s) gin_trgm_ops)",
		QuoteIdentifier(recordSearchIndexName(tableName)),
		QuoteIdentifier(tableName),
		searchExpression,
	)
}

func isRecordIDSearchTerm(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return false
	}

	if _, err := uuid.Parse(trimmed); err == nil {
		return true
	}

	for _, char := range trimmed {
		if !unicode.IsDigit(char) {
			return false
		}
	}

	return true
}

func buildRecordSearchClause(columnTypes map[string]string, placeholder string, rawSearch string) string {
	searchExpression := BuildRecordSearchExpression(columnTypes)
	includeIDSearch := isRecordIDSearchTerm(rawSearch)

	switch {
	case searchExpression == "" && includeIDSearch:
		return fmt.Sprintf("%s::text ILIKE %s", QuoteIdentifier("id"), placeholder)
	case searchExpression == "":
		return ""
	case includeIDSearch:
		return fmt.Sprintf("((%s LIKE %s) OR (%s::text ILIKE %s))", searchExpression, placeholder, QuoteIdentifier("id"), placeholder)
	default:
		return fmt.Sprintf("%s LIKE %s", searchExpression, placeholder)
	}
}

func normalizeRecordCountMode(filters map[string][]string) recordCountMode {
	if filters["skip_count"] != nil {
		return recordCountDeferred
	}
	if rawModes, ok := filters["count_mode"]; ok {
		for _, rawMode := range rawModes {
			switch strings.ToLower(strings.TrimSpace(rawMode)) {
			case string(recordCountDeferred), "skip":
				return recordCountDeferred
			case string(recordCountAuto):
				return recordCountAuto
			case string(recordCountExact):
				return recordCountExact
			}
		}
	}
	return recordCountExact
}

func shouldUseDeferredRecordCount(mode recordCountMode, hasSearch bool, offset int, filterCount int) bool {
	switch mode {
	case recordCountDeferred:
		return true
	case recordCountAuto:
		return hasSearch || offset > 0 || filterCount > 0
	default:
		return false
	}
}

// ListRecords fetches all records with filters and sorting, respecting RLS if configured in DB.
// This implementation uses a structured QueryBuilder for improved maintainability.
func (db *DB) ListRecords(ctx context.Context, collectionName string, filters map[string][]string, orderBy string, limit, offset int) (*ListRecordsResult, error) {
	if !IsValidIdentifier(collectionName) {
		return nil, fmt.Errorf("invalid collection name: %s", collectionName)
	}

	result := &ListRecordsResult{
		Data:       []map[string]any{},
		TotalExact: true,
	}

	isSystemTable := strings.HasPrefix(collectionName, "_v_") || strings.HasPrefix(collectionName, "_ozy_")

	// 1. Fetch ALL columns dynamically for precise validation
	validCols, err := db.GetTableColumns(ctx, collectionName)
	if err != nil {
		return nil, err
	}
	columnTypes, err := db.GetTableColumnTypes(ctx, collectionName)
	if err != nil {
		return nil, err
	}
	if len(validCols) == 0 {
		return nil, fmt.Errorf("table not found or empty: %s", collectionName)
	}

	err = db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		qb := NewQueryBuilder(collectionName)
		hasSearch := false
		filterCount := 0

		// 2. Structural Filters (Soft Delete) - Only if column exists
		if !isSystemTable && validCols["deleted_at"] {
			qb.whereClauses = append(qb.whereClauses, `"deleted_at" IS NULL`)
		}

		// 3. Search Logic
		if qValues, ok := filters["q"]; ok && len(qValues) > 0 && qValues[0] != "" {
			hasSearch = true
			placeholder := fmt.Sprintf("$%d", qb.argIdx)
			searchValue := strings.TrimSpace(qValues[0])
			if searchClause := buildRecordSearchClause(columnTypes, placeholder, searchValue); searchClause != "" {
				qb.whereClauses = append(qb.whereClauses, searchClause)
				qb.args = append(qb.args, "%"+strings.ToLower(searchValue)+"%")
				qb.argIdx++
			} else if validCols["id"] {
				qb.Where("id", "ilike", searchValue)
			}
		}

		// 4. Dynamic Filters
		for col, values := range filters {
			if col == "order" || col == "select" || col == "limit" || col == "offset" || col == "q" {
				continue
			}
			if !IsValidIdentifier(col) || !validCols[col] {
				continue
			}

			for _, valStr := range values {
				filterCount++
				parts := strings.SplitN(valStr, ".", 2)
				op, val := "eq", valStr
				if len(parts) == 2 {
					op, val = parts[0], parts[1]
				}
				qb.Where(col, op, val)
			}
		}

		// 5. Sorting and Pagination
		skipCount := shouldUseDeferredRecordCount(normalizeRecordCountMode(filters), hasSearch, offset, filterCount)
		if orderBy != "" {
			qb.Order(orderBy)
		} else if validCols["created_at"] {
			qb.Order("created_at DESC")
		}
		queryLimit := limit
		if skipCount && limit > 0 {
			queryLimit = limit + 1
		}
		qb.Paginate(queryLimit, offset)

		// 5. Execution - Count (Optional for performance)
		if !skipCount {
			countQuery, args := qb.BuildCount()
			if err := tx.QueryRow(ctx, countQuery, args...).Scan(&result.Total); err != nil {
				return err
			}
		} else {
			result.Total = -1 // Indicator that count was skipped
			result.TotalExact = false
		}

		// 6. Execution - Data
		dataQuery, args := qb.BuildSelect()
		rows, err := tx.Query(ctx, dataQuery, args...)
		if err != nil {
			return err
		}
		defer rows.Close()

		result.Data, err = rowsToMaps(rows)
		if err != nil {
			return err
		}

		if skipCount && limit > 0 && len(result.Data) > limit {
			result.HasMore = true
			result.Data = result.Data[:limit]
		}

		if !result.TotalExact {
			result.Total = int64(offset + len(result.Data))
			if result.HasMore {
				result.Total++
			}
		}

		return nil
	})

	return result, err
}

// GetRecord fetches a single record, respecting RLS
func (db *DB) GetRecord(ctx context.Context, collectionName, id string, ownerField, ownerID string) (map[string]any, error) {
	var record map[string]any
	err := db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		identityColumn, err := db.resolveRowIdentityColumn(ctx, collectionName)
		if err != nil {
			return err
		}
		if identityColumn == "" {
			return ErrRecordNotFound
		}

		where := fmt.Sprintf("%s::text = $1", QuoteIdentifier(identityColumn))
		var queryArgs []any
		queryArgs = append(queryArgs, id)
		argIdx := 2

		if db.HasColumn(ctx, collectionName, "deleted_at") {
			where += ` AND "deleted_at" IS NULL`
		}

		if ownerField != "" && ownerID != "" && db.HasColumn(ctx, collectionName, ownerField) {
			where += fmt.Sprintf(" AND %s = $%d", QuoteIdentifier(ownerField), argIdx)
			queryArgs = append(queryArgs, ownerID)
		}

		query := fmt.Sprintf("SELECT * FROM %s WHERE %s", QuoteIdentifier(collectionName), where)
		rows, err := tx.Query(ctx, query, queryArgs...)
		if err != nil {
			return err
		}
		defer rows.Close()

		records, err := rowsToMaps(rows)
		if err != nil {
			return err
		}
		if len(records) == 0 {
			return ErrRecordNotFound
		}
		record = records[0]
		return nil
	})
	return record, err
}

// UpdateRecord updates a record, respecting RLS
func (db *DB) UpdateRecord(ctx context.Context, collectionName, id string, data map[string]any, ownerField, ownerID string) error {
	if !IsValidIdentifier(collectionName) {
		return fmt.Errorf("invalid collection name: %s", collectionName)
	}

	// 🔐 Security: Global auto-hash for sensitive fields
	autoHashSensitiveData(data)

	return db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		identityColumn, err := db.resolveRowIdentityColumn(ctx, collectionName)
		if err != nil {
			return err
		}
		if identityColumn == "" {
			return ErrRecordNotFound
		}

		var updates []string
		var values []any
		i := 1

		for col, val := range data {
			if !IsValidIdentifier(col) {
				continue
			}
			if col == identityColumn || col == "id" || col == "created_at" || col == "updated_at" {
				continue
			}
			updates = append(updates, fmt.Sprintf("%s = $%d", QuoteIdentifier(col), i))
			values = append(values, val)
			i++
		}

		if len(updates) == 0 {
			return nil
		}

		hasUpdatedAt := db.HasColumn(ctx, collectionName, "updated_at")

		setClause := strings.Join(updates, ", ")
		if hasUpdatedAt {
			setClause += `, "updated_at" = NOW()`
		}

		query := fmt.Sprintf("UPDATE %s SET %s", QuoteIdentifier(collectionName), setClause)

		query += fmt.Sprintf(" WHERE %s::text = $%d", QuoteIdentifier(identityColumn), i)
		values = append(values, id)
		i++

		if db.HasColumn(ctx, collectionName, "deleted_at") {
			query += ` AND "deleted_at" IS NULL`
		}

		if ownerField != "" && ownerID != "" && db.HasColumn(ctx, collectionName, ownerField) {
			query += fmt.Sprintf(" AND %s = $%d", QuoteIdentifier(ownerField), i)
			values = append(values, ownerID)
		}

		result, err := tx.Exec(ctx, query, values...)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return ErrRecordNotFound
		}
		return nil
	})
}

// DeleteRecord soft-deletes a record, respecting RLS
func (db *DB) DeleteRecord(ctx context.Context, collectionName, id string, ownerField, ownerID string) error {
	return db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		identityColumn, err := db.resolveRowIdentityColumn(ctx, collectionName)
		if err != nil {
			return err
		}
		if identityColumn == "" {
			return ErrRecordNotFound
		}

		usesSoftDelete := db.HasColumn(ctx, collectionName, "deleted_at")
		query := ""
		if usesSoftDelete {
			query = fmt.Sprintf(
				"UPDATE %s SET \"deleted_at\" = NOW() WHERE %s::text = $1",
				QuoteIdentifier(collectionName),
				QuoteIdentifier(identityColumn),
			)
		} else {
			query = fmt.Sprintf(
				"DELETE FROM %s WHERE %s::text = $1",
				QuoteIdentifier(collectionName),
				QuoteIdentifier(identityColumn),
			)
		}
		args := []any{id}
		argIdx := 2

		if usesSoftDelete {
			query += ` AND "deleted_at" IS NULL`
		}

		if ownerField != "" && ownerID != "" && db.HasColumn(ctx, collectionName, ownerField) {
			query += fmt.Sprintf(" AND %s = $%d", QuoteIdentifier(ownerField), argIdx)
			args = append(args, ownerID)
		}

		result, err := tx.Exec(ctx, query, args...)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return ErrRecordNotFound
		}
		return nil
	})
}

// BulkUpdateRecords updates multiple records in one statement.
func (db *DB) BulkUpdateRecords(ctx context.Context, collectionName string, ids []string, data map[string]any, ownerField, ownerID string) (int64, error) {
	if !IsValidIdentifier(collectionName) {
		return 0, fmt.Errorf("invalid collection name: %s", collectionName)
	}
	if len(ids) == 0 {
		return 0, nil
	}

	var affected int64
	err := db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		identityColumn, err := db.resolveRowIdentityColumn(ctx, collectionName)
		if err != nil {
			return err
		}
		if identityColumn == "" {
			return fmt.Errorf("table %s does not expose a supported row identity column", collectionName)
		}

		var updates []string
		var args []any
		argIdx := 1

		for col, val := range data {
			if !IsValidIdentifier(col) {
				continue
			}
			if col == identityColumn || col == "id" || col == "created_at" || col == "updated_at" || col == "deleted_at" {
				continue
			}
			updates = append(updates, fmt.Sprintf("%s = $%d", QuoteIdentifier(col), argIdx))
			args = append(args, val)
			argIdx++
		}

		if len(updates) == 0 {
			return fmt.Errorf("no valid fields provided for bulk update")
		}
		if db.HasColumn(ctx, collectionName, "updated_at") {
			updates = append(updates, `"updated_at" = NOW()`)
		}

		query := fmt.Sprintf(
			"UPDATE %s SET %s WHERE %s::text = ANY($%d::text[])",
			QuoteIdentifier(collectionName),
			strings.Join(updates, ", "),
			QuoteIdentifier(identityColumn),
			argIdx,
		)
		args = append(args, ids)
		argIdx++

		if db.HasColumn(ctx, collectionName, "deleted_at") {
			query += ` AND "deleted_at" IS NULL`
		}

		if ownerField != "" && ownerID != "" && db.HasColumn(ctx, collectionName, ownerField) {
			query += fmt.Sprintf(" AND %s = $%d", QuoteIdentifier(ownerField), argIdx)
			args = append(args, ownerID)
		}

		result, err := tx.Exec(ctx, query, args...)
		if err != nil {
			return err
		}
		affected = result.RowsAffected()
		return nil
	})
	return affected, err
}

// BulkDeleteRecords soft-deletes multiple records in one statement.
func (db *DB) BulkDeleteRecords(ctx context.Context, collectionName string, ids []string, ownerField, ownerID string) (int64, error) {
	if !IsValidIdentifier(collectionName) {
		return 0, fmt.Errorf("invalid collection name: %s", collectionName)
	}
	if len(ids) == 0 {
		return 0, nil
	}

	var affected int64
	err := db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		identityColumn, err := db.resolveRowIdentityColumn(ctx, collectionName)
		if err != nil {
			return err
		}
		if identityColumn == "" {
			return fmt.Errorf("table %s does not expose a supported row identity column", collectionName)
		}

		usesSoftDelete := db.HasColumn(ctx, collectionName, "deleted_at")
		query := ""
		if usesSoftDelete {
			query = fmt.Sprintf(
				"UPDATE %s SET \"deleted_at\" = NOW() WHERE %s::text = ANY($1::text[])",
				QuoteIdentifier(collectionName),
				QuoteIdentifier(identityColumn),
			)
		} else {
			query = fmt.Sprintf(
				"DELETE FROM %s WHERE %s::text = ANY($1::text[])",
				QuoteIdentifier(collectionName),
				QuoteIdentifier(identityColumn),
			)
		}
		args := []any{ids}
		argIdx := 2

		if usesSoftDelete {
			query += ` AND "deleted_at" IS NULL`
		}

		if ownerField != "" && ownerID != "" && db.HasColumn(ctx, collectionName, ownerField) {
			query += fmt.Sprintf(" AND %s = $%d", QuoteIdentifier(ownerField), argIdx)
			args = append(args, ownerID)
		}

		result, err := tx.Exec(ctx, query, args...)
		if err != nil {
			return err
		}
		affected = result.RowsAffected()
		return nil
	})
	return affected, err
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
			record[string(fd.Name)] = normalizeRecordValue(values[i])
		}
		results = append(results, record)
	}

	return results, rows.Err()
}

func normalizeRecordValue(value any) any {
	switch v := value.(type) {
	case nil:
		return nil
	case time.Time:
		return v.UTC().Format(time.RFC3339Nano)
	case uuid.UUID:
		return v.String()
	case [16]byte:
		return uuid.UUID(v).String()
	case []byte:
		if len(v) == 16 {
			if parsed, err := uuid.FromBytes(v); err == nil {
				return parsed.String()
			}
		}
		if utf8.Valid(v) {
			return string(v)
		}
		return base64.StdEncoding.EncodeToString(v)
	case fmt.Stringer:
		return v.String()
	case []any:
		out := make([]any, len(v))
		for i := range v {
			out[i] = normalizeRecordValue(v[i])
		}
		return out
	default:
		return value
	}
}

// BulkInsertRecord inserts multiple records in chunks while preserving
// PostgreSQL type coercion and surfacing row-level errors when a chunk fails.
func (db *DB) BulkInsertRecord(ctx context.Context, collectionName string, records []map[string]any) error {
	if len(records) == 0 {
		return nil
	}

	if !IsValidIdentifier(collectionName) {
		return fmt.Errorf("invalid collection name: %s", collectionName)
	}

	validColumns, err := db.GetTableColumns(ctx, collectionName)
	if err != nil {
		return err
	}
	columnTypes, err := db.GetTableColumnTypes(ctx, collectionName)
	if err != nil {
		return err
	}

	columns := collectBulkInsertColumns(validColumns, records)

	if len(columns) == 0 {
		return fmt.Errorf("no valid columns found for import")
	}

	return db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		chunkSize := bulkInsertChunkSize(len(columns))
		diagnostics := newBulkImportDiagnosticCollector(maxBulkImportRowErrors)

		for start := 0; start < len(records); start += chunkSize {
			end := start + chunkSize
			if end > len(records) {
				end = len(records)
			}
			if err := execBulkInsertChunk(ctx, tx, collectionName, columns, columnTypes, records[start:end], start, diagnostics); err != nil {
				return err
			}
			if diagnostics.exhausted() {
				break
			}
		}
		if importErr := diagnostics.toError(); importErr != nil {
			return importErr
		}
		return nil
	})
}

func collectBulkInsertColumns(validColumns map[string]bool, records []map[string]any) []string {
	columnSet := make(map[string]struct{})
	for _, record := range records {
		for col := range record {
			if !IsValidIdentifier(col) || !validColumns[col] {
				continue
			}
			if col == "id" || col == "created_at" || col == "updated_at" || col == "deleted_at" {
				continue
			}
			columnSet[col] = struct{}{}
		}
	}

	columns := make([]string, 0, len(columnSet))
	for col := range columnSet {
		columns = append(columns, col)
	}
	sort.Strings(columns)
	return columns
}

func bulkInsertChunkSize(columnCount int) int {
	if columnCount <= 0 {
		return 1
	}

	const maxParams = 65535
	const maxRowsPerChunk = 250

	chunkSize := maxParams / columnCount
	if chunkSize < 1 {
		return 1
	}
	if chunkSize > maxRowsPerChunk {
		return maxRowsPerChunk
	}
	return chunkSize
}

func execBulkInsertChunk(ctx context.Context, tx pgx.Tx, collectionName string, columns []string, columnTypes map[string]string, records []map[string]any, rowOffset int, diagnostics *bulkImportDiagnosticCollector) error {
	if len(records) == 0 || diagnostics.exhausted() {
		return nil
	}

	savepoint, err := tx.Begin(ctx)
	if err != nil {
		return err
	}

	query, values, err := buildBulkInsertStatement(collectionName, columns, columnTypes, records, rowOffset)
	if err == nil {
		if _, err = savepoint.Exec(ctx, query, values...); err == nil {
			return savepoint.Commit(ctx)
		}
	}
	_ = savepoint.Rollback(ctx)

	if len(records) == 1 {
		diagnostics.addRowError(rowOffset+1, err)
		return nil
	}

	midpoint := len(records) / 2
	if midpoint < 1 {
		midpoint = 1
	}

	if err := execBulkInsertChunk(ctx, tx, collectionName, columns, columnTypes, records[:midpoint], rowOffset, diagnostics); err != nil {
		return err
	}
	if diagnostics.exhausted() {
		return nil
	}
	if err := execBulkInsertChunk(ctx, tx, collectionName, columns, columnTypes, records[midpoint:], rowOffset+midpoint, diagnostics); err != nil {
		return err
	}
	return nil
}

func buildBulkInsertStatement(collectionName string, columns []string, columnTypes map[string]string, records []map[string]any, rowOffset int) (string, []any, error) {
	var builder strings.Builder
	builder.Grow(len(collectionName) + len(columns)*16 + len(records)*len(columns)*6)
	builder.WriteString("INSERT INTO ")
	builder.WriteString(QuoteIdentifier(collectionName))
	builder.WriteString(" (")
	quotedColumns := make([]string, 0, len(columns))
	for _, column := range columns {
		quotedColumns = append(quotedColumns, QuoteIdentifier(column))
	}
	builder.WriteString(strings.Join(quotedColumns, ", "))
	builder.WriteString(") VALUES ")

	values := make([]any, 0, len(records)*len(columns))
	argIndex := 1

	for rowIndex, record := range records {
		if rowIndex > 0 {
			builder.WriteString(", ")
		}
		builder.WriteString("(")
		for colIndex, col := range columns {
			if colIndex > 0 {
				builder.WriteString(", ")
			}
			builder.WriteString("$")
			builder.WriteString(strconv.Itoa(argIndex))
			value, err := normalizeImportedValue(columnTypes[col], record[col])
			if err != nil {
				return "", nil, fmt.Errorf("row %d column %s: %w", rowOffset+rowIndex+1, col, err)
			}
			values = append(values, value)
			argIndex++
		}
		builder.WriteString(")")
	}

	return builder.String(), values, nil
}

// autoHashSensitiveData iterates through data and hashes any fields that match sensitive names.
func autoHashSensitiveData(data map[string]any) {
	sensitiveNames := []string{"password", "password_hash", "passwd", "secret_key", "api_key_secret"}
	for _, name := range sensitiveNames {
		if val, ok := data[name].(string); ok {
			data[name] = maybeHashPassword(val)
		}
	}
}

// maybeHashPassword checks if a string is already a bcrypt hash, and if not, hashes it.
func maybeHashPassword(password string) string {
	if password == "" {
		return ""
	}
	// Simple check: bcrypt hashes usually start with $2a$ or $2b$ and are long.
	if strings.HasPrefix(password, "$2a$") || strings.HasPrefix(password, "$2b$") {
		if len(password) >= 60 {
			return password
		}
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return password // Fallback to plain if hashing fails (should not happen)
	}
	return string(hashed)
}

func normalizeImportedValue(columnType string, raw any) (any, error) {
	if raw == nil {
		return nil, nil
	}

	typeName := strings.ToLower(strings.TrimSpace(columnType))
	switch value := raw.(type) {
	case string:
		return normalizeImportedString(typeName, value)
	case json.RawMessage:
		return normalizeImportedString(typeName, string(value))
	case float64:
		return normalizeImportedNumber(typeName, value)
	case float32:
		return normalizeImportedNumber(typeName, float64(value))
	case int:
		return normalizeImportedNumber(typeName, float64(value))
	case int32:
		return normalizeImportedNumber(typeName, float64(value))
	case int64:
		return normalizeImportedNumber(typeName, float64(value))
	case bool:
		if isBooleanImportType(typeName) {
			return value, nil
		}
		return value, nil
	default:
		if isJSONImportType(typeName) {
			encoded, err := json.Marshal(value)
			if err != nil {
				return nil, fmt.Errorf("encode json value: %w", err)
			}
			return json.RawMessage(encoded), nil
		}
		return value, nil
	}
}

func normalizeImportedString(typeName, raw string) (any, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}

	switch {
	case isBooleanImportType(typeName):
		switch strings.ToLower(trimmed) {
		case "true", "t", "1", "yes", "y", "on":
			return true, nil
		case "false", "f", "0", "no", "n", "off":
			return false, nil
		default:
			return nil, fmt.Errorf("expected boolean value")
		}
	case isIntegerImportType(typeName):
		parsed, err := strconv.ParseInt(trimmed, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("expected integer value")
		}
		return parsed, nil
	case isNumericImportType(typeName):
		parsed, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return nil, fmt.Errorf("expected numeric value")
		}
		return parsed, nil
	case isUUIDImportType(typeName):
		if _, err := uuid.Parse(trimmed); err != nil {
			return nil, fmt.Errorf("expected UUID value")
		}
		return trimmed, nil
	case isDateTimeImportType(typeName):
		parsed, err := parseImportedTime(trimmed)
		if err != nil {
			return nil, err
		}
		if typeName == "date" {
			return parsed.Format("2006-01-02"), nil
		}
		return parsed, nil
	case isJSONImportType(typeName):
		if json.Valid([]byte(trimmed)) {
			return json.RawMessage(trimmed), nil
		}
		encoded, err := json.Marshal(trimmed)
		if err != nil {
			return nil, fmt.Errorf("encode json string: %w", err)
		}
		return json.RawMessage(encoded), nil
	default:
		return raw, nil
	}
}

func normalizeImportedNumber(typeName string, value float64) (any, error) {
	switch {
	case isIntegerImportType(typeName):
		return int64(value), nil
	case isNumericImportType(typeName):
		return value, nil
	case isBooleanImportType(typeName):
		return value != 0, nil
	case isJSONImportType(typeName):
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, fmt.Errorf("encode numeric json value: %w", err)
		}
		return json.RawMessage(encoded), nil
	default:
		return value, nil
	}
}

func isBooleanImportType(typeName string) bool {
	return typeName == "boolean" || typeName == "bool"
}

func isIntegerImportType(typeName string) bool {
	switch typeName {
	case "smallint", "integer", "bigint", "int2", "int4", "int8", "smallserial", "serial", "bigserial":
		return true
	default:
		return false
	}
}

func isNumericImportType(typeName string) bool {
	switch typeName {
	case "numeric", "decimal", "real", "double precision", "float4", "float8":
		return true
	default:
		return false
	}
}

func isUUIDImportType(typeName string) bool {
	return typeName == "uuid"
}

func isJSONImportType(typeName string) bool {
	return typeName == "json" || typeName == "jsonb"
}

func isDateTimeImportType(typeName string) bool {
	switch typeName {
	case "date", "timestamp", "timestamp without time zone", "timestamp with time zone", "timestamptz":
		return true
	default:
		return false
	}
}

func parseImportedTime(raw string) (time.Time, error) {
	layouts := []string{
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
		"2006/01/02",
		"02/01/2006",
		"01/02/2006",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("expected date or timestamp value")
}
