package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
)

const sqlExecutionTimeout = 30 * time.Second
const defaultSQLEditorMaxRows = 1000

type sqlExecutionMode string

const (
	sqlExecutionModeAuto      sqlExecutionMode = "auto"
	sqlExecutionModeSafe      sqlExecutionMode = "safe"
	sqlExecutionModeDangerous sqlExecutionMode = "dangerous"
)

type sqlExecutionIntent string

const (
	sqlExecutionIntentRead        sqlExecutionIntent = "read"
	sqlExecutionIntentMutation    sqlExecutionIntent = "mutation"
	sqlExecutionIntentDestructive sqlExecutionIntent = "destructive"
)

type SQLExecuteRequest struct {
	Query         string `json:"query"`
	Mode          string `json:"mode"`
	ConfirmDanger bool   `json:"confirm_danger"`
}

type SQLSyncResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

type SQLExecuteResponse struct {
	Columns       []string        `json:"columns"`
	Rows          [][]interface{} `json:"rows"`
	RowCount      int             `json:"rowCount"`
	ResultLimit   int             `json:"resultLimit"`
	Truncated     bool            `json:"truncated"`
	ExecutionTime string          `json:"executionTime"`
	Command       string          `json:"command"`
	StatementKind string          `json:"statementKind"`
	RowsAffected  int64           `json:"rowsAffected"`
	HasResultSet  bool            `json:"hasResultSet"`
	Message       string          `json:"message"`
	Intent        string          `json:"intent,omitempty"`
}

type sqlTableMutation struct {
	Action        string
	TableName     string
	PreviousTable string
}

var (
	qualifiedSQLIdentifierPattern = `((?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*))?)`
	createTableSQLPattern         = regexp.MustCompile(`(?is)^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?` + qualifiedSQLIdentifierPattern)
	alterTableSQLPattern          = regexp.MustCompile(`(?is)^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?` + qualifiedSQLIdentifierPattern)
	alterTableRenameSQLPattern    = regexp.MustCompile(`(?is)^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?` + qualifiedSQLIdentifierPattern + `\s+RENAME\s+TO\s+((?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*))`)
	dropTableSQLPattern           = regexp.MustCompile(`(?is)^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)(?:\s+CASCADE|\s+RESTRICT)?\s*$`)
	truncateTableSQLPattern       = regexp.MustCompile(`(?is)^\s*TRUNCATE\s+(?:TABLE\s+)?(.+?)(?:\s+RESTART\s+IDENTITY|\s+CONTINUE\s+IDENTITY|\s+CASCADE|\s+RESTRICT)?\s*$`)
	sqlReadOnlyExplainTarget      = regexp.MustCompile(`(?is)\b(WITH|SELECT|SHOW|VALUES|TABLE|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b`)
	sqlUnsafeWithKeywordPattern   = regexp.MustCompile(`(?is)\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT|VACUUM|CALL|DO|COPY|REFRESH|REINDEX|CLUSTER|SET|RESET|LISTEN|UNLISTEN|NOTIFY)\b`)
	sqlSelectIntoPattern          = regexp.MustCompile(`(?is)^\s*SELECT\b[\s\S]*\bINTO\b`)
	sqlUnsafeSelectIntoPattern    = regexp.MustCompile(`(?is)\bSELECT\b[\s\S]*\bINTO\b`)
)

// HandleExecuteSQL executes a raw SQL query provided by the admin
func (h *Handler) HandleExecuteSQL(c echo.Context) error {
	var req SQLExecuteRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	if req.Query == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Query cannot be empty"})
	}
	intent := classifySQLExecutionIntent(req.Query)
	mode, ok := normalizeSQLExecutionMode(req.Mode)
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]any{
			"error":      "mode must be 'auto', 'safe' or 'dangerous'",
			"error_code": "BAD_REQUEST",
		})
	}
	if mode == sqlExecutionModeSafe && intent != sqlExecutionIntentRead {
		return c.JSON(http.StatusForbidden, map[string]any{
			"error":      "Safe mode only allows read-only SQL. Use dangerous mode for mutating statements.",
			"error_code": "SQL_MUTATION_REQUIRES_ELEVATION",
		})
	}
	if mode == sqlExecutionModeAuto && intent != sqlExecutionIntentRead && !req.ConfirmDanger {
		affectedTables, estimatedRows := h.estimateDestructiveImpact(ctxWithFallback(c), req.Query)
		return c.JSON(http.StatusConflict, map[string]any{
			"error":           "This statement can change or remove data. Confirm before execution.",
			"error_code":      "SQL_CONFIRMATION_REQUIRED",
			"intent":          intent,
			"statement_kind":  sqlStatementKind(req.Query),
			"affected_tables": affectedTables,
			"estimated_rows":  estimatedRows,
		})
	}
	if mode == sqlExecutionModeDangerous {
		role, _ := c.Get("role").(string)
		if strings.TrimSpace(role) != "admin" {
			return c.JSON(http.StatusForbidden, map[string]any{
				"error":      "Dangerous SQL requires admin access.",
				"error_code": "FORBIDDEN",
			})
		}
		if !req.ConfirmDanger {
			return c.JSON(http.StatusConflict, map[string]any{
				"error":      "Dangerous SQL requires explicit confirmation before execution.",
				"error_code": "SQL_DANGEROUS_CONFIRMATION_REQUIRED",
			})
		}
	}

	start := time.Now()
	ctx, cancel := context.WithTimeout(c.Request().Context(), sqlExecutionTimeout)
	defer cancel()

	statementKind := sqlStatementKind(req.Query)
	workspaceID, _ := c.Get("workspace_id").(string)

	if !sqlQueryProducesRows(req.Query) {
		tag, err := h.DB.Pool.Exec(ctx, req.Query)
		if err != nil {
			log.Printf("request_id=%s operation=sql.execute mode=%s statement_kind=%s error=%v", RequestIDFromContext(c), mode, statementKind, err)
			return c.JSON(http.StatusBadRequest, map[string]any{
				"error":      "SQL execution failed. Review the statement and try again.",
				"error_code": "SQL_EXECUTION_FAILED",
			})
		}

		duration := time.Since(start)
		rowsAffected := tag.RowsAffected()
		h.syncCollectionsAfterSQL(ctx, req.Query, workspaceID)
		h.recordSQLHistory(ctx, req.Query, duration, rowsAffected, "success")

		return c.JSON(http.StatusOK, SQLExecuteResponse{
			Columns:       []string{},
			Rows:          [][]interface{}{},
			RowCount:      0,
			ResultLimit:   resolveSQLEditorMaxRows(),
			Truncated:     false,
			ExecutionTime: duration.String(),
			Command:       sqlCommandLabel(tag.String(), statementKind),
			StatementKind: statementKind,
			RowsAffected:  rowsAffected,
			HasResultSet:  false,
			Message:       sqlExecutionMessage(statementKind, false, 0, rowsAffected),
			Intent:        string(intent),
		})
	}

	previewQuery := buildSQLPreviewQuery(req.Query, resolveSQLEditorMaxRows())

	// Execute the query
	rows, err := h.DB.Pool.Query(ctx, previewQuery)
	if err != nil {
		log.Printf("request_id=%s operation=sql.query mode=%s statement_kind=%s error=%v", RequestIDFromContext(c), mode, statementKind, err)
		return c.JSON(http.StatusBadRequest, map[string]any{
			"error":      "SQL execution failed. Review the statement and try again.",
			"error_code": "SQL_EXECUTION_FAILED",
		})
	}
	defer rows.Close()

	// Get column descriptions
	fieldDescriptions := rows.FieldDescriptions()
	columns := make([]string, len(fieldDescriptions))
	for i, fd := range fieldDescriptions {
		columns[i] = string(fd.Name)
	}

	// Fetch rows
	var resultRows [][]interface{}
	rowCount := 0
	rowLimit := resolveSQLEditorMaxRows()
	truncated := false

	for rows.Next() {
		// Create a slice of interface{} to hold the values
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			return internalAPIError(c, http.StatusInternalServerError, "sql.scan_rows", err, "Unable to read SQL results right now.")
		}

		for i := range values {
			values[i] = normalizeSQLResultValue(values[i])
		}

		if rowCount < rowLimit {
			resultRows = append(resultRows, values)
			rowCount++
			continue
		}

		truncated = true
		break
	}

	if rows.Err() != nil {
		return internalAPIError(c, http.StatusInternalServerError, "sql.iterate_rows", rows.Err(), "Unable to read SQL results right now.")
	}

	tag := rows.CommandTag()
	duration := time.Since(start)
	rowsAffected := tag.RowsAffected()
	h.recordSQLHistory(ctx, req.Query, duration, rowsAffected, "success")

	return c.JSON(http.StatusOK, SQLExecuteResponse{
		Columns:       columns,
		Rows:          resultRows,
		RowCount:      rowCount,
		ResultLimit:   rowLimit,
		Truncated:     truncated,
		ExecutionTime: duration.String(),
		Command:       sqlCommandLabel(tag.String(), statementKind),
		StatementKind: statementKind,
		RowsAffected:  rowsAffected,
		HasResultSet:  true,
		Message:       sqlExecutionMessage(statementKind, true, rowCount, rowsAffected),
		Intent:        string(intent),
	})
}

func ctxWithFallback(c echo.Context) context.Context {
	if c == nil || c.Request() == nil {
		return context.Background()
	}
	return c.Request().Context()
}

func resolveSQLEditorMaxRows() int {
	raw := strings.TrimSpace(os.Getenv("OZY_SQL_EDITOR_MAX_ROWS"))
	if raw == "" {
		return defaultSQLEditorMaxRows
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		return defaultSQLEditorMaxRows
	}
	if value < 100 {
		return 100
	}
	if value > 10000 {
		return 10000
	}
	return value
}

func normalizeSQLExecutionMode(raw string) (sqlExecutionMode, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", string(sqlExecutionModeAuto):
		return sqlExecutionModeAuto, true
	case string(sqlExecutionModeSafe):
		return sqlExecutionModeSafe, true
	case string(sqlExecutionModeDangerous):
		return sqlExecutionModeDangerous, true
	default:
		return "", false
	}
}

func classifySQLExecutionIntent(query string) sqlExecutionIntent {
	statements := splitSQLStatements(query)
	if len(statements) == 0 {
		return sqlExecutionIntentRead
	}

	intent := sqlExecutionIntentRead
	for _, statement := range statements {
		kind := sqlStatementKind(statement)
		if kind == "DROP" || kind == "TRUNCATE" {
			return sqlExecutionIntentDestructive
		}
		if !sqlStatementAllowedInSafeMode(statement) {
			intent = sqlExecutionIntentMutation
		}
	}

	return intent
}

func extractDestructiveTableTargets(query string) []string {
	statements := splitSQLStatements(query)
	seen := map[string]struct{}{}
	targets := make([]string, 0)

	appendTarget := func(name string) {
		if name == "" {
			return
		}
		if _, ok := seen[name]; ok {
			return
		}
		seen[name] = struct{}{}
		targets = append(targets, name)
	}

	for _, statement := range statements {
		switch {
		case dropTableSQLPattern.MatchString(statement):
			match := dropTableSQLPattern.FindStringSubmatch(statement)
			for _, rawTarget := range splitDDLTargetList(match[1]) {
				if tableName, ok := normalizePublicTableIdentifier(rawTarget); ok {
					appendTarget(tableName)
				}
			}
		case truncateTableSQLPattern.MatchString(statement):
			match := truncateTableSQLPattern.FindStringSubmatch(statement)
			for _, rawTarget := range splitDDLTargetList(match[1]) {
				target := strings.TrimSpace(rawTarget)
				if len(target) >= 5 && strings.EqualFold(target[:5], "ONLY ") {
					target = strings.TrimSpace(target[5:])
				}
				target = strings.TrimSpace(target)
				if tableName, ok := normalizePublicTableIdentifier(target); ok {
					appendTarget(tableName)
				}
			}
		}
	}

	return targets
}

func (h *Handler) estimateDestructiveImpact(ctx context.Context, query string) ([]string, int64) {
	tables := extractDestructiveTableTargets(query)
	if len(tables) == 0 {
		return nil, 0
	}

	var estimatedRows int64
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(GREATEST(c.reltuples, 0)::bigint), 0)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public'
		  AND c.relname = ANY($1)
	`, tables).Scan(&estimatedRows)
	if err != nil {
		return tables, 0
	}

	return tables, estimatedRows
}

func sqlQueryAllowedInSafeMode(query string) bool {
	statements := splitSQLStatements(query)
	if len(statements) == 0 {
		return false
	}

	for _, statement := range statements {
		if !sqlStatementAllowedInSafeMode(statement) {
			return false
		}
	}

	return true
}

func sqlStatementAllowedInSafeMode(statement string) bool {
	trimmed := trimLeadingSQLComments(statement)
	if trimmed == "" {
		return false
	}

	switch sqlStatementKind(trimmed) {
	case "SELECT":
		return !sqlSelectIntoPattern.MatchString(trimmed)
	case "SHOW", "VALUES", "TABLE":
		return true
	case "WITH":
		return !sqlUnsafeWithKeywordPattern.MatchString(trimmed) && !sqlUnsafeSelectIntoPattern.MatchString(trimmed)
	case "EXPLAIN":
		target := sqlExplainTarget(trimmed)
		return target != "" && sqlStatementAllowedInSafeMode(target)
	default:
		return false
	}
}

func sqlExplainTarget(statement string) string {
	trimmed := trimLeadingSQLComments(statement)
	if !strings.HasPrefix(strings.ToUpper(trimmed), "EXPLAIN") {
		return ""
	}

	rest := strings.TrimSpace(trimmed[len("EXPLAIN"):])
	if rest == "" {
		return ""
	}
	if strings.HasPrefix(rest, "(") {
		var (
			depth         int
			inSingleQuote bool
			inDoubleQuote bool
		)
		for index := 0; index < len(rest); index++ {
			ch := rest[index]
			if inSingleQuote {
				if ch == '\'' {
					if index+1 < len(rest) && rest[index+1] == '\'' {
						index++
					} else {
						inSingleQuote = false
					}
				}
				continue
			}
			if inDoubleQuote {
				if ch == '"' {
					if index+1 < len(rest) && rest[index+1] == '"' {
						index++
					} else {
						inDoubleQuote = false
					}
				}
				continue
			}
			switch ch {
			case '\'':
				inSingleQuote = true
			case '"':
				inDoubleQuote = true
			case '(':
				depth++
			case ')':
				depth--
				if depth == 0 {
					return strings.TrimSpace(rest[index+1:])
				}
			}
		}
		return ""
	}

	match := sqlReadOnlyExplainTarget.FindStringIndex(rest)
	if match == nil {
		return ""
	}
	return strings.TrimSpace(rest[match[0]:])
}

func (h *Handler) syncCollectionsAfterSQL(ctx context.Context, query string, workspaceID string) {
	mutations := extractSQLTableMutations(query)
	if len(mutations) == 0 {
		return
	}

	for _, mutation := range mutations {
		var err error
		switch mutation.Action {
		case "upsert":
			err = h.upsertCollectionMetadataForTable(ctx, mutation.TableName, workspaceID)
		case "rename":
			err = h.renameCollectionMetadataForTable(ctx, mutation.PreviousTable, mutation.TableName, workspaceID)
		case "drop":
			err = h.deleteCollectionMetadataForTable(ctx, mutation.TableName)
		}
		if err != nil {
			log.Printf("Warning: Failed to sync SQL collection metadata for %s (%s): %v", mutation.TableName, mutation.Action, err)
		}
	}
}

func extractSQLTableMutations(query string) []sqlTableMutation {
	statements := splitSQLStatements(query)
	mutations := make([]sqlTableMutation, 0, len(statements))
	seen := make(map[string]struct{})

	appendMutation := func(item sqlTableMutation) {
		key := strings.Join([]string{item.Action, item.PreviousTable, item.TableName}, "|")
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		mutations = append(mutations, item)
	}

	for _, statement := range statements {
		switch {
		case alterTableRenameSQLPattern.MatchString(statement):
			match := alterTableRenameSQLPattern.FindStringSubmatch(statement)
			oldTableName, okOld := normalizePublicTableIdentifier(match[1])
			newTableName, okNew := normalizePublicTableIdentifier(match[2])
			if okOld && okNew {
				appendMutation(sqlTableMutation{
					Action:        "rename",
					TableName:     newTableName,
					PreviousTable: oldTableName,
				})
			}
		case createTableSQLPattern.MatchString(statement):
			match := createTableSQLPattern.FindStringSubmatch(statement)
			if tableName, ok := normalizePublicTableIdentifier(match[1]); ok {
				appendMutation(sqlTableMutation{Action: "upsert", TableName: tableName})
			}
		case alterTableSQLPattern.MatchString(statement):
			match := alterTableSQLPattern.FindStringSubmatch(statement)
			if tableName, ok := normalizePublicTableIdentifier(match[1]); ok {
				appendMutation(sqlTableMutation{Action: "upsert", TableName: tableName})
			}
		case dropTableSQLPattern.MatchString(statement):
			match := dropTableSQLPattern.FindStringSubmatch(statement)
			for _, rawTarget := range splitDDLTargetList(match[1]) {
				if tableName, ok := normalizePublicTableIdentifier(rawTarget); ok {
					appendMutation(sqlTableMutation{Action: "drop", TableName: tableName})
				}
			}
		}
	}

	return mutations
}

func splitSQLStatements(raw string) []string {
	var (
		builder        strings.Builder
		statements     []string
		inSingleQuote  bool
		inDoubleQuote  bool
		inLineComment  bool
		inBlockComment bool
	)

	flush := func() {
		statement := strings.TrimSpace(builder.String())
		if statement != "" {
			statements = append(statements, statement)
		}
		builder.Reset()
	}

	for i := 0; i < len(raw); i++ {
		ch := raw[i]

		if inLineComment {
			if ch == '\n' {
				inLineComment = false
				builder.WriteByte('\n')
			}
			continue
		}
		if inBlockComment {
			if ch == '*' && i+1 < len(raw) && raw[i+1] == '/' {
				inBlockComment = false
				i++
			}
			continue
		}
		if inSingleQuote {
			builder.WriteByte(ch)
			if ch == '\'' {
				if i+1 < len(raw) && raw[i+1] == '\'' {
					builder.WriteByte(raw[i+1])
					i++
				} else {
					inSingleQuote = false
				}
			}
			continue
		}
		if inDoubleQuote {
			builder.WriteByte(ch)
			if ch == '"' {
				if i+1 < len(raw) && raw[i+1] == '"' {
					builder.WriteByte(raw[i+1])
					i++
				} else {
					inDoubleQuote = false
				}
			}
			continue
		}

		if ch == '-' && i+1 < len(raw) && raw[i+1] == '-' {
			inLineComment = true
			i++
			continue
		}
		if ch == '/' && i+1 < len(raw) && raw[i+1] == '*' {
			inBlockComment = true
			i++
			continue
		}
		if ch == '\'' {
			inSingleQuote = true
			builder.WriteByte(ch)
			continue
		}
		if ch == '"' {
			inDoubleQuote = true
			builder.WriteByte(ch)
			continue
		}
		if ch == ';' {
			flush()
			continue
		}

		builder.WriteByte(ch)
	}

	flush()
	return statements
}

func splitDDLTargetList(raw string) []string {
	items := []string{}
	var (
		builder       strings.Builder
		inDoubleQuote bool
	)

	flush := func() {
		item := strings.TrimSpace(builder.String())
		if item != "" {
			items = append(items, item)
		}
		builder.Reset()
	}

	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		if inDoubleQuote {
			builder.WriteByte(ch)
			if ch == '"' {
				if i+1 < len(raw) && raw[i+1] == '"' {
					builder.WriteByte(raw[i+1])
					i++
				} else {
					inDoubleQuote = false
				}
			}
			continue
		}
		if ch == '"' {
			inDoubleQuote = true
			builder.WriteByte(ch)
			continue
		}
		if ch == ',' {
			flush()
			continue
		}
		builder.WriteByte(ch)
	}

	flush()
	return items
}

func normalizePublicTableIdentifier(raw string) (string, bool) {
	parts := splitQualifiedIdentifier(raw)
	if len(parts) == 0 || len(parts) > 2 {
		return "", false
	}

	normalizePart := func(part string) (string, bool) {
		part = strings.TrimSpace(part)
		if part == "" {
			return "", false
		}
		if strings.HasPrefix(part, "\"") && strings.HasSuffix(part, "\"") {
			part = strings.TrimPrefix(strings.TrimSuffix(part, "\""), "\"")
			part = strings.ReplaceAll(part, `""`, `"`)
		}
		if !data.IsValidIdentifier(part) {
			return "", false
		}
		return part, true
	}

	if len(parts) == 1 {
		tableName, ok := normalizePart(parts[0])
		return tableName, ok
	}

	schemaName, ok := normalizePart(parts[0])
	if !ok || !strings.EqualFold(schemaName, "public") {
		return "", false
	}

	tableName, ok := normalizePart(parts[1])
	return tableName, ok
}

func splitQualifiedIdentifier(raw string) []string {
	parts := []string{}
	var (
		builder       strings.Builder
		inDoubleQuote bool
	)

	flush := func() {
		part := strings.TrimSpace(builder.String())
		if part != "" {
			parts = append(parts, part)
		}
		builder.Reset()
	}

	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		if inDoubleQuote {
			builder.WriteByte(ch)
			if ch == '"' {
				if i+1 < len(raw) && raw[i+1] == '"' {
					builder.WriteByte(raw[i+1])
					i++
				} else {
					inDoubleQuote = false
				}
			}
			continue
		}
		if ch == '"' {
			inDoubleQuote = true
			builder.WriteByte(ch)
			continue
		}
		if ch == '.' {
			flush()
			continue
		}
		builder.WriteByte(ch)
	}

	flush()
	return parts
}

func sqlQueryProducesRows(query string) bool {
	switch sqlStatementKind(query) {
	case "SELECT", "WITH", "SHOW", "EXPLAIN", "VALUES", "TABLE":
		return true
	case "INSERT", "UPDATE", "DELETE", "MERGE":
		return strings.Contains(strings.ToUpper(trimLeadingSQLComments(query)), "RETURNING")
	default:
		return false
	}
}

func buildSQLPreviewQuery(raw string, rowLimit int) string {
	if rowLimit <= 0 {
		return raw
	}

	statements := splitSQLStatements(raw)
	if len(statements) != 1 {
		return raw
	}

	statement := strings.TrimSpace(statements[0])
	if statement == "" {
		return raw
	}

	switch sqlStatementKind(statement) {
	case "SELECT", "WITH", "VALUES", "TABLE":
		return fmt.Sprintf("SELECT * FROM (%s) AS _ozy_preview LIMIT %d", statement, rowLimit+1)
	default:
		return raw
	}
}

func sqlCommandLabel(commandTag string, statementKind string) string {
	commandTag = strings.TrimSpace(commandTag)
	if commandTag != "" {
		return commandTag
	}
	return statementKind
}

func sqlExecutionMessage(statementKind string, hasResultSet bool, rowCount int, rowsAffected int64) string {
	switch {
	case hasResultSet:
		return fmt.Sprintf("%s returned %d row(s).", statementKind, rowCount)
	case rowsAffected > 0:
		return fmt.Sprintf("%s executed successfully. %d row(s) affected.", statementKind, rowsAffected)
	default:
		return fmt.Sprintf("%s executed successfully.", statementKind)
	}
}

func normalizeSQLResultValue(value any) any {
	switch v := value.(type) {
	case nil:
		return nil
	case time.Time:
		return v.UTC().Format(time.RFC3339Nano)
	case []byte:
		if utf8.Valid(v) {
			return string(v)
		}
		return base64.StdEncoding.EncodeToString(v)
	case fmt.Stringer:
		return v.String()
	case []any:
		out := make([]any, len(v))
		for i := range v {
			out[i] = normalizeSQLResultValue(v[i])
		}
		return out
	default:
		return value
	}
}

// HandleSyncSystem triggers the internal migrations to repair system schema
func (h *Handler) HandleSyncSystem(c echo.Context) error {
	if err := h.DB.RunMigrations(c.Request().Context()); err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "sql.sync_system", err, "Unable to sync the system schema right now.")
	}

	return c.JSON(http.StatusOK, SQLSyncResponse{
		Status:  "success",
		Message: "System schema synced and repaired successfully",
	})
}
// HandleGetSQLHistory returns the list of recently executed SQL queries
func (h *Handler) HandleGetSQLHistory(c echo.Context) error {
	ctx := c.Request().Context()
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT id, query, executed_at, duration, rows_affected, status
		FROM "_v_sql_history"
		ORDER BY executed_at DESC
		LIMIT 100
	`)
	if err != nil {
		// Auto-heal if table missing
		_ = h.ensureSQLHistorySchema(ctx)
		return c.JSON(http.StatusOK, []any{})
	}
	defer rows.Close()

	type historyItem struct {
		ID           string    `json:"id"`
		Query        string    `json:"query"`
		ExecutedAt   time.Time `json:"executed_at"`
		Duration     string    `json:"duration"`
		RowsAffected int64     `json:"rows_affected"`
		Status       string    `json:"status"`
	}

	items := make([]historyItem, 0)
	for rows.Next() {
		var item historyItem
		if err := rows.Scan(&item.ID, &item.Query, &item.ExecutedAt, &item.Duration, &item.RowsAffected, &item.Status); err == nil {
			items = append(items, item)
		}
	}
	return c.JSON(http.StatusOK, items)
}

// HandleClearSQLHistory removes all records from the SQL history
func (h *Handler) HandleClearSQLHistory(c echo.Context) error {
	ctx := c.Request().Context()
	_, err := h.DB.Pool.Exec(ctx, `DELETE FROM "_v_sql_history"`)
	if err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "sql.clear_history", err, "Failed to clear SQL history.")
	}
	return c.JSON(http.StatusOK, map[string]string{"status": "success"})
}

func (h *Handler) ensureSQLHistorySchema(ctx context.Context) error {
	_, err := h.DB.Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS "_v_sql_history" (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			workspace_id UUID,
			query TEXT NOT NULL,
			executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			duration TEXT,
			rows_affected BIGINT DEFAULT 0,
			status TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_sql_history_executed_at ON "_v_sql_history"(executed_at DESC);
	`)
	return err
}

func (h *Handler) recordSQLHistory(ctx context.Context, query string, duration time.Duration, rowsAffected int64, status string) {
	_, _ = h.DB.Pool.Exec(ctx, `
		INSERT INTO "_v_sql_history" (query, duration, rows_affected, status)
		VALUES ($1, $2, $3, $4)
	`, query, duration.String(), rowsAffected, status)
}
