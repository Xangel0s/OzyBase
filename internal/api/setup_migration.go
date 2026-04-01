package api

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

type setupMigrationRequest struct {
	SourceKind string `json:"source_kind"`
	TableName  string `json:"table_name,omitempty"`
	RawInput   string `json:"raw_input"`
	ImportRows bool   `json:"import_rows"`
}

type setupMigrationColumnPreview struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Required  bool   `json:"required"`
	IsPrimary bool   `json:"is_primary,omitempty"`
}

type setupMigrationTablePreview struct {
	Name          string                        `json:"name"`
	DisplayName   string                        `json:"display_name"`
	ColumnCount   int                           `json:"column_count"`
	DetectedRows  int                           `json:"detected_rows"`
	TranslatedSQL string                        `json:"translated_sql"`
	Columns       []setupMigrationColumnPreview `json:"columns"`
	Warnings      []string                      `json:"warnings,omitempty"`
}

type setupMigrationPreviewResponse struct {
	SourceKind string                       `json:"source_kind"`
	Summary    string                       `json:"summary"`
	TableCount int                          `json:"table_count"`
	RowCount   int                          `json:"row_count"`
	Warnings   []string                     `json:"warnings,omitempty"`
	Tables     []setupMigrationTablePreview `json:"tables"`
}

type setupMigrationPlan struct {
	SourceKind string
	Tables     []setupMigrationTablePlan
	Warnings   []string
	TotalRows  int
}

type setupMigrationTablePlan struct {
	Name          string
	DisplayName   string
	Schema        []data.FieldSchema
	Rows          []map[string]any
	DetectedRows  int
	TranslatedSQL string
	Warnings      []string
}

type setupMigrationApplyResult struct {
	MigratedTableCount int
	ImportedRowCount   int
	Warnings           []string
}

type setupParsedInsert struct {
	TableName string
	Columns   []string
	Rows      []map[string]any
	Warnings  []string
}

var blockSQLCommentsPattern = regexp.MustCompile(`(?s)/\*.*?\*/`)

func (h *Handler) PreviewSetupMigration(c echo.Context) error {
	var req setupMigrationRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	normalizeSetupMigrationRequest(&req)
	if err := validateSetupMigrationRequest(req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	plan, err := buildSetupMigrationPlan(req)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	if h != nil && h.DB != nil && h.DB.Pool != nil {
		if warnings, warnErr := collectExistingMigrationWarnings(c.Request().Context(), h.DB, plan.Tables); warnErr == nil {
			plan.Warnings = append(plan.Warnings, warnings...)
		}
	}

	return c.JSON(http.StatusOK, buildSetupMigrationPreviewResponse(plan))
}

func normalizeSetupMigrationRequest(req *setupMigrationRequest) {
	req.SourceKind = strings.ToLower(strings.TrimSpace(req.SourceKind))
	req.TableName = sanitizeSetupIdentifier(req.TableName, "imported_records")
	req.RawInput = strings.TrimSpace(strings.ReplaceAll(req.RawInput, "\r\n", "\n"))
}

func validateSetupMigrationRequest(req setupMigrationRequest) error {
	if req.SourceKind == "" {
		return fmt.Errorf("Migration source is required")
	}

	switch req.SourceKind {
	case "csv", "mongo_json", "mysql_sql", "sqlite_sql", "sqlserver_sql", "postgres_sql":
	default:
		return fmt.Errorf("Unsupported migration source. Allowed: csv, mongo_json, mysql_sql, sqlite_sql, sqlserver_sql, postgres_sql")
	}

	if req.RawInput == "" {
		return fmt.Errorf("Migration input is required")
	}

	if (req.SourceKind == "csv" || req.SourceKind == "mongo_json") && req.TableName == "" {
		return fmt.Errorf("Table name is required for %s imports", req.SourceKind)
	}

	return nil
}

func buildSetupMigrationPlan(req setupMigrationRequest) (setupMigrationPlan, error) {
	switch req.SourceKind {
	case "csv":
		return buildCSVMigrationPlan(req)
	case "mongo_json":
		return buildMongoJSONMigrationPlan(req)
	case "mysql_sql", "sqlite_sql", "sqlserver_sql", "postgres_sql":
		return buildSQLMigrationPlan(req)
	default:
		return setupMigrationPlan{}, fmt.Errorf("unsupported migration source: %s", req.SourceKind)
	}
}

func buildCSVMigrationPlan(req setupMigrationRequest) (setupMigrationPlan, error) {
	delimiter := detectCSVDelimiter(req.RawInput)
	reader := csv.NewReader(strings.NewReader(req.RawInput))
	reader.Comma = delimiter
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true

	rows, err := reader.ReadAll()
	if err != nil {
		return setupMigrationPlan{}, fmt.Errorf("failed to parse CSV: %w", err)
	}
	if len(rows) == 0 {
		return setupMigrationPlan{}, fmt.Errorf("CSV input is empty")
	}

	headers := uniqueSanitizedIdentifiers(rows[0], "column")
	if len(headers) == 0 {
		return setupMigrationPlan{}, fmt.Errorf("CSV header row is empty")
	}

	columnSamples := make([][]string, len(headers))
	requiredCounts := make([]int, len(headers))
	records := make([]map[string]any, 0, len(rows)-1)

	for rowIndex := 1; rowIndex < len(rows); rowIndex++ {
		line := rows[rowIndex]
		record := make(map[string]any)
		for colIndex, column := range headers {
			value := ""
			if colIndex < len(line) {
				value = strings.TrimSpace(line[colIndex])
			}
			if value == "" {
				continue
			}
			record[column] = value
			requiredCounts[colIndex]++
			if len(columnSamples[colIndex]) < 32 {
				columnSamples[colIndex] = append(columnSamples[colIndex], value)
			}
		}
		if len(record) > 0 {
			records = append(records, record)
		}
	}

	schema := make([]data.FieldSchema, 0, len(headers))
	for index, column := range headers {
		schema = append(schema, data.FieldSchema{
			Name:     column,
			Type:     inferFieldTypeFromStringSamples(columnSamples[index]),
			Required: len(records) > 0 && requiredCounts[index] == len(records),
		})
	}

	tableName := sanitizeSetupIdentifier(req.TableName, "imported_csv")
	table := setupMigrationTablePlan{
		Name:         tableName,
		DisplayName:  buildSetupDisplayName(tableName),
		Schema:       schema,
		DetectedRows: len(records),
	}
	if req.ImportRows {
		table.Rows = records
	}

	if err := finalizeSetupMigrationTable(&table); err != nil {
		return setupMigrationPlan{}, err
	}

	return setupMigrationPlan{
		SourceKind: req.SourceKind,
		Tables:     []setupMigrationTablePlan{table},
		TotalRows:  table.DetectedRows,
	}, nil
}

func buildMongoJSONMigrationPlan(req setupMigrationRequest) (setupMigrationPlan, error) {
	documents, warnings, err := parseMongoDocuments(req.RawInput)
	if err != nil {
		return setupMigrationPlan{}, err
	}
	if len(documents) == 0 {
		return setupMigrationPlan{}, fmt.Errorf("Mongo-like JSON payload does not contain documents")
	}

	normalizedRecords := make([]map[string]any, 0, len(documents))
	for _, document := range documents {
		record := make(map[string]any)
		for key, value := range document {
			record[sanitizeSetupIdentifier(key, "field")] = value
		}
		if len(record) > 0 {
			normalizedRecords = append(normalizedRecords, record)
		}
	}

	tableName := sanitizeSetupIdentifier(req.TableName, "imported_documents")
	table := setupMigrationTablePlan{
		Name:         tableName,
		DisplayName:  buildSetupDisplayName(tableName),
		Schema:       inferSchemaFromRecords(normalizedRecords),
		DetectedRows: len(normalizedRecords),
		Warnings:     warnings,
	}
	if req.ImportRows {
		table.Rows = normalizedRecords
	}

	if err := finalizeSetupMigrationTable(&table); err != nil {
		return setupMigrationPlan{}, err
	}

	return setupMigrationPlan{
		SourceKind: req.SourceKind,
		Tables:     []setupMigrationTablePlan{table},
		Warnings:   warnings,
		TotalRows:  table.DetectedRows,
	}, nil
}

func buildSetupMigrationPreviewResponse(plan setupMigrationPlan) setupMigrationPreviewResponse {
	tables := make([]setupMigrationTablePreview, 0, len(plan.Tables))
	for _, table := range plan.Tables {
		columnPreviews := make([]setupMigrationColumnPreview, 0, len(table.Schema))
		for _, field := range table.Schema {
			columnPreviews = append(columnPreviews, setupMigrationColumnPreview{
				Name:      field.Name,
				Type:      field.Type,
				Required:  field.Required,
				IsPrimary: field.IsPrimary,
			})
		}
		tables = append(tables, setupMigrationTablePreview{
			Name:          table.Name,
			DisplayName:   table.DisplayName,
			ColumnCount:   len(table.Schema),
			DetectedRows:  table.DetectedRows,
			TranslatedSQL: table.TranslatedSQL,
			Columns:       columnPreviews,
			Warnings:      table.Warnings,
		})
	}

	summary := fmt.Sprintf("Prepared %d table(s) and %d row(s) for PostgreSQL migration.", len(plan.Tables), plan.TotalRows)
	if plan.TotalRows == 0 {
		summary = fmt.Sprintf("Prepared %d table(s) for PostgreSQL schema migration.", len(plan.Tables))
	}

	return setupMigrationPreviewResponse{
		SourceKind: plan.SourceKind,
		Summary:    summary,
		TableCount: len(plan.Tables),
		RowCount:   plan.TotalRows,
		Warnings:   uniqueStrings(plan.Warnings),
		Tables:     tables,
	}
}

func collectExistingMigrationWarnings(ctx context.Context, db *data.DB, tables []setupMigrationTablePlan) ([]string, error) {
	if db == nil || db.Pool == nil || len(tables) == 0 {
		return nil, nil
	}

	warnings := make([]string, 0)
	for _, table := range tables {
		exists, err := setupUserTableExists(ctx, db, table.Name)
		if err != nil {
			return nil, err
		}
		if exists {
			warnings = append(warnings, fmt.Sprintf("Target table %s already exists in this project.", table.Name))
		}
	}

	return uniqueStrings(warnings), nil
}

func finalizeSetupMigrationTable(table *setupMigrationTablePlan) error {
	if table == nil {
		return fmt.Errorf("Migration table cannot be nil")
	}
	table.Name = sanitizeSetupIdentifier(table.Name, "imported_table")
	if table.DisplayName == "" {
		table.DisplayName = buildSetupDisplayName(table.Name)
	}
	if len(table.Schema) == 0 {
		return fmt.Errorf("Migration table %s does not define any columns", table.Name)
	}

	normalizedSchema := make([]data.FieldSchema, 0, len(table.Schema))
	seen := make(map[string]int)
	for index, field := range table.Schema {
		field.Name = sanitizeSetupIdentifier(field.Name, fmt.Sprintf("column_%d", index+1))
		field.Type = normalizeOzyType(field.Type)
		if field.Type == "" {
			field.Type = "text"
		}
		count := seen[field.Name]
		seen[field.Name] = count + 1
		if count > 0 {
			field.Name = fmt.Sprintf("%s_%d", field.Name, count+1)
		}
		normalizedSchema = append(normalizedSchema, field)
	}
	table.Schema = normalizedSchema

	createSQL, err := data.BuildCreateTableSQL(table.Name, table.Schema)
	if err != nil {
		return fmt.Errorf("failed to translate %s into PostgreSQL: %w", table.Name, err)
	}
	table.TranslatedSQL = createSQL
	table.Warnings = uniqueStrings(table.Warnings)
	return nil
}

func buildSQLMigrationPlan(req setupMigrationRequest) (setupMigrationPlan, error) {
	normalized := stripSQLComments(req.RawInput)
	statements := splitSetupMigrationStatements(normalized)
	if len(statements) == 0 {
		return setupMigrationPlan{}, fmt.Errorf("No SQL statements were detected in the migration input")
	}

	tablePlans := make(map[string]*setupMigrationTablePlan)
	order := make([]string, 0)
	warnings := make([]string, 0)

	for _, statement := range statements {
		trimmed := strings.TrimSpace(statement)
		if trimmed == "" {
			continue
		}

		upper := strings.ToUpper(trimmed)
		switch {
		case strings.HasPrefix(upper, "CREATE TABLE"):
			table, tableWarnings, err := parseSQLCreateTable(req.SourceKind, trimmed)
			if err != nil {
				return setupMigrationPlan{}, err
			}
			if _, exists := tablePlans[table.Name]; !exists {
				order = append(order, table.Name)
			}
			for _, warning := range tableWarnings {
				table.Warnings = append(table.Warnings, warning)
			}
			tablePlans[table.Name] = &table
		case req.ImportRows && strings.HasPrefix(upper, "INSERT INTO"):
			parsed, err := parseSQLInsertStatement(trimmed)
			if err != nil {
				return setupMigrationPlan{}, err
			}
			if len(parsed.Rows) == 0 {
				warnings = append(warnings, fmt.Sprintf("Ignored INSERT into %s because no row values were parsed.", parsed.TableName))
				continue
			}
			table, exists := tablePlans[parsed.TableName]
			if !exists {
				table = &setupMigrationTablePlan{
					Name:        parsed.TableName,
					DisplayName: buildSetupDisplayName(parsed.TableName),
				}
				tablePlans[parsed.TableName] = table
				order = append(order, parsed.TableName)
			}
			table.Rows = append(table.Rows, parsed.Rows...)
			table.DetectedRows += len(parsed.Rows)
			table.Warnings = append(table.Warnings, parsed.Warnings...)
		default:
			warnings = append(warnings, fmt.Sprintf("Ignored unsupported setup statement: %s", summarizeSQLStatement(trimmed)))
		}
	}

	plans := make([]setupMigrationTablePlan, 0, len(order))
	for _, name := range order {
		table := tablePlans[name]
		if table == nil {
			continue
		}
		if len(table.Schema) == 0 {
			if len(table.Rows) == 0 {
				return setupMigrationPlan{}, fmt.Errorf("Could not build a schema for %s. Provide a CREATE TABLE statement or named INSERT columns", name)
			}
			table.Schema = inferSchemaFromRecords(table.Rows)
			table.Warnings = append(table.Warnings, "Schema was inferred from INSERT statements because no CREATE TABLE statement was provided.")
		}
		if table.DetectedRows == 0 {
			table.DetectedRows = len(table.Rows)
		}
		if err := finalizeSetupMigrationTable(table); err != nil {
			return setupMigrationPlan{}, err
		}
		plans = append(plans, *table)
	}

	orderedPlans, orderingWarnings := orderMigrationTablesByDependencies(plans)
	warnings = append(warnings, orderingWarnings...)

	totalRows := 0
	for _, table := range orderedPlans {
		totalRows += table.DetectedRows
	}

	return setupMigrationPlan{
		SourceKind: req.SourceKind,
		Tables:     orderedPlans,
		Warnings:   uniqueStrings(warnings),
		TotalRows:  totalRows,
	}, nil
}

func applySetupMigration(ctx context.Context, tx pgx.Tx, plan setupMigrationPlan) (setupMigrationApplyResult, error) {
	result := setupMigrationApplyResult{
		MigratedTableCount: len(plan.Tables),
	}

	for _, table := range plan.Tables {
		exists, err := setupUserTableExistsTx(ctx, tx, table.Name)
		if err != nil {
			return result, err
		}
		if exists {
			if len(table.Rows) > 0 {
				return result, fmt.Errorf("table %s already exists; setup migration expects a fresh target before importing rows", table.Name)
			}
			result.Warnings = append(result.Warnings, fmt.Sprintf("Table %s already existed, so setup only refreshed its metadata.", table.Name))
			if err := upsertMigrationCollectionMetadata(ctx, tx, table); err != nil {
				return result, err
			}
			continue
		}

		if _, err := tx.Exec(ctx, table.TranslatedSQL); err != nil {
			return result, fmt.Errorf("failed to create migrated table %s: %w", table.Name, err)
		}

		if err := upsertMigrationCollectionMetadata(ctx, tx, table); err != nil {
			return result, err
		}

		if len(table.Rows) == 0 {
			continue
		}

		inserted, err := insertMigrationRowsTx(ctx, tx, table)
		if err != nil {
			return result, err
		}
		result.ImportedRowCount += inserted
	}

	result.Warnings = uniqueStrings(append(result.Warnings, plan.Warnings...))
	return result, nil
}

func upsertMigrationCollectionMetadata(ctx context.Context, tx pgx.Tx, table setupMigrationTablePlan) error {
	schemaJSON, err := json.Marshal(table.Schema)
	if err != nil {
		return fmt.Errorf("failed to encode migrated schema for %s: %w", table.Name, err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO _v_collections (
			name,
			display_name,
			schema_def,
			list_rule,
			create_rule,
			rls_enabled,
			rls_rule,
			realtime_enabled,
			updated_at
		)
		VALUES ($1, $2, $3, 'auth', 'admin', FALSE, 'auth.uid() = owner_id', FALSE, NOW())
		ON CONFLICT (name) DO UPDATE SET
			display_name = COALESCE(NULLIF(_v_collections.display_name, ''), EXCLUDED.display_name),
			schema_def = EXCLUDED.schema_def,
			updated_at = NOW()
	`, table.Name, table.DisplayName, schemaJSON)
	if err != nil {
		return fmt.Errorf("failed to register migrated table %s: %w", table.Name, err)
	}

	return nil
}

func insertMigrationRowsTx(ctx context.Context, tx pgx.Tx, table setupMigrationTablePlan) (int, error) {
	if len(table.Rows) == 0 {
		return 0, nil
	}

	fieldMap := make(map[string]data.FieldSchema, len(table.Schema))
	orderedColumns := make([]string, 0, len(table.Schema))
	for _, field := range table.Schema {
		fieldMap[field.Name] = field
		orderedColumns = append(orderedColumns, field.Name)
	}

	columns := make([]string, 0, len(orderedColumns))
	for _, column := range orderedColumns {
		if (column == "created_at" || column == "updated_at" || column == "deleted_at") && !migrationRowsContainField(table.Rows, column) {
			continue
		}
		if migrationRowsContainField(table.Rows, column) {
			columns = append(columns, column)
		}
	}

	if len(columns) == 0 {
		return 0, nil
	}

	var builder strings.Builder
	builder.WriteString("INSERT INTO ")
	builder.WriteString(table.Name)
	builder.WriteString(" (")
	builder.WriteString(strings.Join(columns, ", "))
	builder.WriteString(") VALUES ")

	args := make([]any, 0, len(table.Rows)*len(columns))
	argIndex := 1

	for rowIndex, record := range table.Rows {
		if rowIndex > 0 {
			builder.WriteString(", ")
		}
		builder.WriteString("(")
		for colIndex, column := range columns {
			if colIndex > 0 {
				builder.WriteString(", ")
			}
			field := fieldMap[column]
			builder.WriteString(migrationPlaceholderForField(field, argIndex))
			value, err := normalizeMigrationInsertValue(field.Type, record[column])
			if err != nil {
				return rowIndex, fmt.Errorf("row %d column %s: %w", rowIndex+1, column, err)
			}
			args = append(args, value)
			argIndex++
		}
		builder.WriteString(")")
	}

	if _, err := tx.Exec(ctx, builder.String(), args...); err != nil {
		return 0, fmt.Errorf("failed to insert migrated rows into %s: %w", table.Name, err)
	}

	return len(table.Rows), nil
}

func migrationRowsContainField(rows []map[string]any, field string) bool {
	for _, row := range rows {
		if _, ok := row[field]; ok {
			return true
		}
	}
	return false
}

func migrationPlaceholderForField(field data.FieldSchema, index int) string {
	placeholder := "$" + strconv.Itoa(index)
	if cast, ok := data.TypeMapping[strings.ToLower(field.Type)]; ok {
		return placeholder + "::" + strings.ToLower(cast)
	}
	return placeholder
}

func normalizeMigrationInsertValue(fieldType string, raw any) (any, error) {
	if raw == nil {
		return nil, nil
	}

	switch normalizeOzyType(fieldType) {
	case "int2", "int4", "int8", "integer", "number":
		return normalizeIntegerValue(raw)
	case "float4", "float8", "numeric":
		return normalizeNumericValue(raw)
	case "boolean", "bool":
		return normalizeBooleanValue(raw)
	case "json", "jsonb":
		bytes, err := json.Marshal(raw)
		if err != nil {
			return nil, err
		}
		return string(bytes), nil
	case "bytea":
		switch value := raw.(type) {
		case []byte:
			return value, nil
		case string:
			return []byte(value), nil
		default:
			return []byte(fmt.Sprint(value)), nil
		}
	default:
		return normalizeStringLikeValue(raw), nil
	}
}

func normalizeIntegerValue(raw any) (any, error) {
	switch value := raw.(type) {
	case int:
		return int64(value), nil
	case int8:
		return int64(value), nil
	case int16:
		return int64(value), nil
	case int32:
		return int64(value), nil
	case int64:
		return value, nil
	case float32:
		return int64(value), nil
	case float64:
		return int64(value), nil
	case json.Number:
		return value.Int64()
	case string:
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return nil, nil
		}
		return strconv.ParseInt(trimmed, 10, 64)
	default:
		return strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
	}
}

func normalizeNumericValue(raw any) (any, error) {
	switch value := raw.(type) {
	case int, int8, int16, int32, int64, float32, float64:
		return value, nil
	case json.Number:
		return value.Float64()
	case string:
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return nil, nil
		}
		return strconv.ParseFloat(trimmed, 64)
	default:
		return strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
	}
}

func normalizeBooleanValue(raw any) (any, error) {
	switch value := raw.(type) {
	case bool:
		return value, nil
	case string:
		trimmed := strings.TrimSpace(strings.ToLower(value))
		switch trimmed {
		case "":
			return nil, nil
		case "true", "t", "1", "yes", "y":
			return true, nil
		case "false", "f", "0", "no", "n":
			return false, nil
		default:
			return nil, fmt.Errorf("invalid boolean value %q", value)
		}
	default:
		return nil, fmt.Errorf("invalid boolean value %v", raw)
	}
}

func normalizeStringLikeValue(raw any) string {
	switch value := raw.(type) {
	case string:
		return strings.TrimSpace(value)
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func parseMongoDocuments(raw string) ([]map[string]any, []string, error) {
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()

	var payload any
	if err := decoder.Decode(&payload); err != nil {
		return nil, nil, fmt.Errorf("failed to parse Mongo-like JSON: %w", err)
	}

	switch value := payload.(type) {
	case []any:
		documents := make([]map[string]any, 0, len(value))
		for _, item := range value {
			document, ok := item.(map[string]any)
			if !ok {
				return nil, nil, fmt.Errorf("Mongo-like JSON arrays must contain objects only")
			}
			documents = append(documents, document)
		}
		return documents, nil, nil
	case map[string]any:
		if documentsRaw, ok := value["documents"].([]any); ok {
			documents := make([]map[string]any, 0, len(documentsRaw))
			for _, item := range documentsRaw {
				document, valid := item.(map[string]any)
				if !valid {
					return nil, nil, fmt.Errorf("The documents field must contain objects only")
				}
				documents = append(documents, document)
			}
			return documents, []string{"Detected a wrapper object and used its documents array as the migration source."}, nil
		}
		return []map[string]any{value}, []string{"Detected a single JSON object and treated it as one document row."}, nil
	default:
		return nil, nil, fmt.Errorf("Mongo-like JSON must be a document object, a documents wrapper, or an array of documents")
	}
}

func parseSQLCreateTable(sourceKind, statement string) (setupMigrationTablePlan, []string, error) {
	name, body, err := extractCreateTableParts(statement)
	if err != nil {
		return setupMigrationTablePlan{}, nil, err
	}

	definitions := splitCommaAware(body)
	schema := make([]data.FieldSchema, 0, len(definitions))
	tablePrimaryKeys := make(map[string]struct{})
	warnings := make([]string, 0)

	for _, definition := range definitions {
		trimmed := strings.TrimSpace(definition)
		if trimmed == "" {
			continue
		}

		upper := strings.ToUpper(trimmed)
		switch {
		case strings.HasPrefix(upper, "PRIMARY KEY"), strings.HasPrefix(upper, "CONSTRAINT"):
			for _, column := range parseReferencedColumns(trimmed) {
				tablePrimaryKeys[column] = struct{}{}
			}
			continue
		case strings.HasPrefix(upper, "UNIQUE"), strings.HasPrefix(upper, "FOREIGN KEY"), strings.HasPrefix(upper, "CHECK"):
			warnings = append(warnings, fmt.Sprintf("Ignored table-level constraint in %s: %s", name, summarizeSQLStatement(trimmed)))
			continue
		}

		field, fieldWarnings, err := parseSQLColumnDefinition(sourceKind, trimmed)
		if err != nil {
			return setupMigrationTablePlan{}, nil, fmt.Errorf("failed to parse %s definition %q: %w", name, trimmed, err)
		}
		schema = append(schema, field)
		warnings = append(warnings, fieldWarnings...)
	}

	if len(schema) == 0 {
		return setupMigrationTablePlan{}, nil, fmt.Errorf("CREATE TABLE %s does not define any usable columns", name)
	}

	for index := range schema {
		if _, ok := tablePrimaryKeys[schema[index].Name]; ok {
			schema[index].IsPrimary = true
			schema[index].Required = true
		}
	}

	return setupMigrationTablePlan{
		Name:        name,
		DisplayName: buildSetupDisplayName(name),
		Schema:      schema,
	}, uniqueStrings(warnings), nil
}

func extractCreateTableParts(statement string) (string, string, error) {
	trimmed := strings.TrimSpace(strings.TrimSuffix(statement, ";"))
	upper := strings.ToUpper(trimmed)
	if !strings.HasPrefix(upper, "CREATE TABLE") {
		return "", "", fmt.Errorf("statement is not a CREATE TABLE")
	}

	rest := strings.TrimSpace(trimmed[len("CREATE TABLE"):])
	restUpper := strings.ToUpper(rest)
	if strings.HasPrefix(restUpper, "IF NOT EXISTS") {
		rest = strings.TrimSpace(rest[len("IF NOT EXISTS"):])
	}

	openIndex := indexOfRuneOutsideQuoted(rest, '(')
	if openIndex == -1 {
		return "", "", fmt.Errorf("CREATE TABLE statement is missing an opening parenthesis")
	}

	namePart := strings.TrimSpace(rest[:openIndex])
	body, _, err := extractParenthesizedSegment(rest[openIndex:])
	if err != nil {
		return "", "", err
	}

	return normalizeQualifiedIdentifier(namePart, "imported_table"), body, nil
}

func parseSQLColumnDefinition(sourceKind, definition string) (data.FieldSchema, []string, error) {
	tokens := splitDefinitionTokens(definition)
	if len(tokens) < 2 {
		return data.FieldSchema{}, nil, fmt.Errorf("column definition is incomplete")
	}

	field := data.FieldSchema{
		Name: sanitizeSetupIdentifier(tokens[0], "column"),
	}

	typeTokens := make([]string, 0)
	index := 1
	for ; index < len(tokens); index++ {
		tokenUpper := strings.ToUpper(tokens[index])
		if isSQLConstraintKeyword(tokenUpper) {
			break
		}
		typeTokens = append(typeTokens, tokens[index])
	}
	if len(typeTokens) == 0 {
		return data.FieldSchema{}, nil, fmt.Errorf("missing column type")
	}

	typeWarnings := make([]string, 0)
	field.Type, typeWarnings = mapExternalTypeToOzy(sourceKind, strings.Join(typeTokens, " "))

	remainder := strings.ToUpper(strings.Join(tokens[index:], " "))
	field.Required = strings.Contains(remainder, "NOT NULL") || strings.Contains(remainder, "PRIMARY KEY")
	field.Unique = strings.Contains(remainder, "UNIQUE")
	field.IsPrimary = strings.Contains(remainder, "PRIMARY KEY") || looksLikeSQLitePrimaryKey(strings.Join(typeTokens, " "), remainder)

	if references := parseReferences(definition); references != "" {
		field.References = references
	}
	if defaultValue, ok := parseSimpleDefaultValue(definition); ok {
		field.Default = defaultValue
	}

	return field, typeWarnings, nil
}

func parseSQLInsertStatement(statement string) (setupParsedInsert, error) {
	trimmed := strings.TrimSpace(strings.TrimSuffix(statement, ";"))
	upper := strings.ToUpper(trimmed)
	if !strings.HasPrefix(upper, "INSERT INTO") {
		return setupParsedInsert{}, fmt.Errorf("statement is not an INSERT INTO")
	}

	rest := strings.TrimSpace(trimmed[len("INSERT INTO"):])
	valuesIndex := indexKeywordOutsideStructured(rest, "VALUES")
	if valuesIndex == -1 {
		return setupParsedInsert{}, fmt.Errorf("INSERT statement is missing VALUES")
	}

	head := strings.TrimSpace(rest[:valuesIndex])
	valuesRaw := strings.TrimSpace(rest[valuesIndex+len("VALUES"):])
	if valuesRaw == "" {
		return setupParsedInsert{}, fmt.Errorf("INSERT statement does not include any row values")
	}

	tablePart := head
	columns := make([]string, 0)
	if openIndex := indexOfRuneOutsideQuoted(head, '('); openIndex != -1 {
		closeIndex := strings.LastIndex(head, ")")
		if closeIndex == -1 || closeIndex <= openIndex {
			return setupParsedInsert{}, fmt.Errorf("INSERT column list is malformed")
		}
		tablePart = strings.TrimSpace(head[:openIndex])
		columns = uniqueSanitizedIdentifiers(splitCommaAware(head[openIndex+1:closeIndex]), "column")
	}
	if len(columns) == 0 {
		return setupParsedInsert{}, fmt.Errorf("INSERT statements without named columns are not supported in setup migration")
	}

	tuples, err := parseSQLValueTuples(valuesRaw)
	if err != nil {
		return setupParsedInsert{}, err
	}

	rows := make([]map[string]any, 0, len(tuples))
	for _, tuple := range tuples {
		values := splitCommaAware(tuple)
		if len(values) != len(columns) {
			return setupParsedInsert{}, fmt.Errorf("INSERT value count does not match its column count for table %s", tablePart)
		}
		record := make(map[string]any, len(columns))
		for index, token := range values {
			value, parseErr := parseSQLLiteral(token)
			if parseErr != nil {
				return setupParsedInsert{}, parseErr
			}
			if value != nil {
				record[columns[index]] = value
			}
		}
		rows = append(rows, record)
	}

	return setupParsedInsert{
		TableName: normalizeQualifiedIdentifier(tablePart, "imported_table"),
		Columns:   columns,
		Rows:      rows,
	}, nil
}

func parseSQLValueTuples(raw string) ([]string, error) {
	tuples := make([]string, 0)
	current := strings.Builder{}
	depth := 0
	inSingle := false
	inDouble := false
	inBacktick := false
	inBracket := false

	for index, char := range raw {
		switch char {
		case '\'':
			if !inDouble && !inBacktick && !inBracket {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle && !inBacktick && !inBracket {
				inDouble = !inDouble
			}
		case '`':
			if !inSingle && !inDouble && !inBracket {
				inBacktick = !inBacktick
			}
		case '[':
			if !inSingle && !inDouble && !inBacktick {
				inBracket = true
			}
		case ']':
			if inBracket && !inSingle && !inDouble && !inBacktick {
				inBracket = false
			}
		}

		if inSingle || inDouble || inBacktick || inBracket {
			current.WriteRune(char)
			continue
		}

		switch char {
		case '(':
			if depth > 0 {
				current.WriteRune(char)
			}
			depth++
		case ')':
			depth--
			if depth < 0 {
				return nil, fmt.Errorf("INSERT values contain unbalanced parentheses")
			}
			if depth == 0 {
				tuples = append(tuples, current.String())
				current.Reset()
				continue
			}
			current.WriteRune(char)
		default:
			if depth > 0 {
				current.WriteRune(char)
			} else if !unicode.IsSpace(char) && char != ',' {
				return nil, fmt.Errorf("unexpected token %q near INSERT values at position %d", string(char), index)
			}
		}
	}

	if depth != 0 {
		return nil, fmt.Errorf("INSERT values contain incomplete tuples")
	}

	return tuples, nil
}

func parseSQLLiteral(token string) (any, error) {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" || strings.EqualFold(trimmed, "NULL") || strings.EqualFold(trimmed, "DEFAULT") {
		return nil, nil
	}
	if strings.HasPrefix(strings.ToUpper(trimmed), "N'") && strings.HasSuffix(trimmed, "'") {
		trimmed = trimmed[1:]
	}
	if strings.HasPrefix(trimmed, "'") && strings.HasSuffix(trimmed, "'") && len(trimmed) >= 2 {
		value := strings.ReplaceAll(trimmed[1:len(trimmed)-1], "''", "'")
		return value, nil
	}
	if strings.EqualFold(trimmed, "TRUE") {
		return true, nil
	}
	if strings.EqualFold(trimmed, "FALSE") {
		return false, nil
	}
	if integer, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
		return integer, nil
	}
	if numeric, err := strconv.ParseFloat(trimmed, 64); err == nil {
		return numeric, nil
	}
	return trimmed, nil
}

func inferSchemaFromRecords(records []map[string]any) []data.FieldSchema {
	if len(records) == 0 {
		return []data.FieldSchema{{
			Name: "value",
			Type: "text",
		}}
	}

	keys := make(map[string]struct{})
	requiredCounts := make(map[string]int)
	samples := make(map[string][]any)

	for _, record := range records {
		for key, value := range record {
			keys[key] = struct{}{}
			if value != nil && fmt.Sprint(value) != "" {
				requiredCounts[key]++
			}
			if len(samples[key]) < 32 {
				samples[key] = append(samples[key], value)
			}
		}
	}

	ordered := make([]string, 0, len(keys))
	for key := range keys {
		ordered = append(ordered, key)
	}
	sort.Strings(ordered)

	schema := make([]data.FieldSchema, 0, len(ordered))
	for _, key := range ordered {
		schema = append(schema, data.FieldSchema{
			Name:     sanitizeSetupIdentifier(key, "field"),
			Type:     inferFieldTypeFromAnySamples(samples[key]),
			Required: requiredCounts[key] == len(records),
		})
	}

	return schema
}

func inferFieldTypeFromStringSamples(samples []string) string {
	values := make([]string, 0, len(samples))
	for _, sample := range samples {
		trimmed := strings.TrimSpace(sample)
		if trimmed != "" {
			values = append(values, trimmed)
		}
	}
	if len(values) == 0 {
		return "text"
	}
	if allStringsMatch(values, isBooleanLikeString) {
		return "boolean"
	}
	if allStringsMatch(values, isIntegerString) {
		return "int8"
	}
	if allStringsMatch(values, isNumericString) {
		return "numeric"
	}
	if allStringsMatch(values, isUUIDLikeString) {
		return "uuid"
	}
	if allStringsMatch(values, isDateLikeString) {
		return "date"
	}
	if allStringsMatch(values, isTimestampLikeString) {
		return "timestamptz"
	}
	return "text"
}

func inferFieldTypeFromAnySamples(samples []any) string {
	nonNil := make([]any, 0, len(samples))
	for _, sample := range samples {
		if sample != nil && fmt.Sprint(sample) != "" {
			nonNil = append(nonNil, sample)
		}
	}
	if len(nonNil) == 0 {
		return "text"
	}

	allBool := true
	allInt := true
	allNumeric := true
	allUUID := true
	allDate := true
	allTimestamp := true
	hasStructured := false

	for _, sample := range nonNil {
		switch value := sample.(type) {
		case bool:
			allInt = false
			allNumeric = false
			allUUID = false
			allDate = false
			allTimestamp = false
		case int, int8, int16, int32, int64, json.Number:
			allBool = false
			allUUID = false
			allDate = false
			allTimestamp = false
		case float32, float64:
			allBool = false
			allInt = false
			allUUID = false
			allDate = false
			allTimestamp = false
		case map[string]any, []any:
			hasStructured = true
			allBool = false
			allInt = false
			allNumeric = false
			allUUID = false
			allDate = false
			allTimestamp = false
		case string:
			trimmed := strings.TrimSpace(value)
			allBool = allBool && isBooleanLikeString(trimmed)
			allInt = allInt && isIntegerString(trimmed)
			allNumeric = allNumeric && isNumericString(trimmed)
			allUUID = allUUID && isUUIDLikeString(trimmed)
			allDate = allDate && isDateLikeString(trimmed)
			allTimestamp = allTimestamp && isTimestampLikeString(trimmed)
		default:
			stringValue := strings.TrimSpace(fmt.Sprint(value))
			allBool = allBool && isBooleanLikeString(stringValue)
			allInt = allInt && isIntegerString(stringValue)
			allNumeric = allNumeric && isNumericString(stringValue)
			allUUID = allUUID && isUUIDLikeString(stringValue)
			allDate = allDate && isDateLikeString(stringValue)
			allTimestamp = allTimestamp && isTimestampLikeString(stringValue)
		}
	}

	if hasStructured {
		return "jsonb"
	}
	if allBool {
		return "boolean"
	}
	if allInt {
		return "int8"
	}
	if allNumeric {
		return "numeric"
	}
	if allUUID {
		return "uuid"
	}
	if allDate {
		return "date"
	}
	if allTimestamp {
		return "timestamptz"
	}
	return "text"
}

func mapExternalTypeToOzy(sourceKind, raw string) (string, []string) {
	normalized := strings.ToUpper(strings.TrimSpace(raw))
	normalized = strings.ReplaceAll(normalized, "`", "")
	normalized = strings.ReplaceAll(normalized, "\"", "")
	normalized = strings.ReplaceAll(normalized, "[", "")
	normalized = strings.ReplaceAll(normalized, "]", "")

	switch {
	case strings.Contains(normalized, "UNIQUEIDENTIFIER"), strings.Contains(normalized, "UUID"):
		return "uuid", nil
	case strings.Contains(normalized, "JSONB"):
		return "jsonb", nil
	case strings.Contains(normalized, "JSON"):
		return "json", nil
	case strings.Contains(normalized, "TINYINT(1)"):
		return "boolean", nil
	case strings.Contains(normalized, "BOOLEAN"), strings.Contains(normalized, "BOOL"), normalized == "BIT":
		return "boolean", nil
	case strings.Contains(normalized, "BIGSERIAL"), strings.Contains(normalized, "BIGINT"):
		return "int8", nil
	case strings.Contains(normalized, "SMALLINT"):
		return "int2", nil
	case strings.Contains(normalized, "SERIAL"), strings.Contains(normalized, "INTEGER"), strings.Contains(normalized, "INT"):
		return "int4", nil
	case strings.Contains(normalized, "DECIMAL"), strings.Contains(normalized, "NUMERIC"), strings.Contains(normalized, "MONEY"):
		return "numeric", nil
	case strings.Contains(normalized, "DOUBLE"), strings.Contains(normalized, "FLOAT"), strings.Contains(normalized, "REAL"):
		return "float8", nil
	case strings.Contains(normalized, "DATETIMEOFFSET"), strings.Contains(normalized, "TIMESTAMP WITH TIME ZONE"), strings.Contains(normalized, "TIMESTAMPTZ"):
		return "timestamptz", nil
	case strings.Contains(normalized, "DATETIME"), strings.Contains(normalized, "DATETIME2"), strings.Contains(normalized, "TIMESTAMP"):
		return "timestamp", nil
	case normalized == "DATE":
		return "date", nil
	case strings.HasPrefix(normalized, "TIME"):
		return "time", nil
	case strings.Contains(normalized, "BYTEA"), strings.Contains(normalized, "BLOB"), strings.Contains(normalized, "BINARY"), strings.Contains(normalized, "VARBINARY"), strings.Contains(normalized, "IMAGE"):
		return "bytea", nil
	case strings.Contains(normalized, "CHAR"), strings.Contains(normalized, "TEXT"), strings.Contains(normalized, "CLOB"), strings.Contains(normalized, "NCHAR"), strings.Contains(normalized, "NVARCHAR"), strings.Contains(normalized, "VARCHAR"):
		return "text", nil
	default:
		return "text", []string{fmt.Sprintf("Translated %s type %q to TEXT because it is not mapped explicitly yet.", sourceKind, raw)}
	}
}

func parseSimpleDefaultValue(definition string) (any, bool) {
	upper := strings.ToUpper(definition)
	index := strings.Index(upper, " DEFAULT ")
	if index == -1 {
		return nil, false
	}
	defaultPart := strings.TrimSpace(definition[index+len(" DEFAULT "):])
	if defaultPart == "" {
		return nil, false
	}

	token := splitDefinitionTokens(defaultPart)
	if len(token) == 0 {
		return nil, false
	}
	candidate := strings.TrimSpace(token[0])
	upperCandidate := strings.ToUpper(candidate)
	if strings.Contains(upperCandidate, "CURRENT_") || strings.Contains(candidate, "(") {
		return nil, false
	}
	if strings.HasPrefix(candidate, "'") && strings.HasSuffix(candidate, "'") && len(candidate) >= 2 {
		return strings.ReplaceAll(candidate[1:len(candidate)-1], "''", "'"), true
	}
	if strings.EqualFold(candidate, "TRUE") {
		return true, true
	}
	if strings.EqualFold(candidate, "FALSE") {
		return false, true
	}
	if integer, err := strconv.ParseInt(candidate, 10, 64); err == nil {
		return integer, true
	}
	if numeric, err := strconv.ParseFloat(candidate, 64); err == nil {
		return numeric, true
	}
	return nil, false
}

func parseReferences(definition string) string {
	upper := strings.ToUpper(definition)
	index := strings.Index(upper, "REFERENCES")
	if index == -1 {
		return ""
	}
	referencePart := strings.TrimSpace(definition[index+len("REFERENCES"):])
	open := indexOfRuneOutsideQuoted(referencePart, '(')
	close := strings.Index(referencePart, ")")
	if open == -1 || close == -1 || close <= open {
		return ""
	}
	tableName := normalizeQualifiedIdentifier(strings.TrimSpace(referencePart[:open]), "")
	columnName := sanitizeSetupIdentifier(referencePart[open+1:close], "")
	if tableName == "" || columnName == "" {
		return ""
	}
	return tableName + "." + columnName
}

func parseReferencedColumns(definition string) []string {
	open := strings.Index(definition, "(")
	close := strings.LastIndex(definition, ")")
	if open == -1 || close == -1 || close <= open {
		return nil
	}
	columns := splitCommaAware(definition[open+1 : close])
	result := make([]string, 0, len(columns))
	for _, column := range columns {
		result = append(result, sanitizeSetupIdentifier(column, ""))
	}
	return result
}

func orderMigrationTablesByDependencies(tables []setupMigrationTablePlan) ([]setupMigrationTablePlan, []string) {
	if len(tables) <= 1 {
		return tables, nil
	}

	indexByName := make(map[string]int, len(tables))
	inDegree := make(map[string]int, len(tables))
	edges := make(map[string][]string, len(tables))

	for index, table := range tables {
		indexByName[table.Name] = index
		if _, ok := inDegree[table.Name]; !ok {
			inDegree[table.Name] = 0
		}
	}

	for _, table := range tables {
		for _, field := range table.Schema {
			if field.References == "" {
				continue
			}
			referenceParts := strings.Split(field.References, ".")
			if len(referenceParts) != 2 {
				continue
			}
			dependency := referenceParts[0]
			if dependency == table.Name {
				continue
			}
			if _, ok := indexByName[dependency]; !ok {
				continue
			}
			edges[dependency] = append(edges[dependency], table.Name)
			inDegree[table.Name]++
		}
	}

	queue := make([]string, 0)
	for _, table := range tables {
		if inDegree[table.Name] == 0 {
			queue = append(queue, table.Name)
		}
	}

	ordered := make([]setupMigrationTablePlan, 0, len(tables))
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		ordered = append(ordered, tables[indexByName[current]])
		for _, dependent := range edges[current] {
			inDegree[dependent]--
			if inDegree[dependent] == 0 {
				queue = append(queue, dependent)
			}
		}
	}

	if len(ordered) != len(tables) {
		return tables, []string{"Detected cyclic table references, so the migration kept the original table order."}
	}

	return ordered, nil
}

func setupUserTableExists(ctx context.Context, db *data.DB, tableName string) (bool, error) {
	if db == nil || db.Pool == nil {
		return false, nil
	}
	return setupUserTableExistsTx(ctx, db.Pool, tableName)
}

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func setupUserTableExistsTx(ctx context.Context, querier rowQuerier, tableName string) (bool, error) {
	var exists bool
	err := querier.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public'
			  AND table_name = $1
			  AND table_type = 'BASE TABLE'
		)
	`, tableName).Scan(&exists)
	return exists, err
}

func stripSQLComments(raw string) string {
	cleaned := blockSQLCommentsPattern.ReplaceAllString(raw, "\n")
	lines := strings.Split(cleaned, "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--") {
			continue
		}
		result = append(result, line)
	}
	return strings.Join(result, "\n")
}

func splitSetupMigrationStatements(raw string) []string {
	statements := make([]string, 0)
	current := strings.Builder{}
	inSingle := false
	inDouble := false
	inBacktick := false
	inBracket := false

	for _, char := range raw {
		switch char {
		case '\'':
			if !inDouble && !inBacktick && !inBracket {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle && !inBacktick && !inBracket {
				inDouble = !inDouble
			}
		case '`':
			if !inSingle && !inDouble && !inBracket {
				inBacktick = !inBacktick
			}
		case '[':
			if !inSingle && !inDouble && !inBacktick {
				inBracket = true
			}
		case ']':
			if inBracket && !inSingle && !inDouble && !inBacktick {
				inBracket = false
			}
		case ';':
			if !inSingle && !inDouble && !inBacktick && !inBracket {
				statement := strings.TrimSpace(current.String())
				if statement != "" {
					statements = append(statements, statement)
				}
				current.Reset()
				continue
			}
		}
		current.WriteRune(char)
	}

	if trailing := strings.TrimSpace(current.String()); trailing != "" {
		statements = append(statements, trailing)
	}

	return statements
}

func extractParenthesizedSegment(raw string) (string, string, error) {
	if raw == "" || raw[0] != '(' {
		return "", "", fmt.Errorf("segment does not begin with a parenthesis")
	}

	depth := 0
	inSingle := false
	inDouble := false
	inBacktick := false
	inBracket := false

	for index, char := range raw {
		switch char {
		case '\'':
			if !inDouble && !inBacktick && !inBracket {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle && !inBacktick && !inBracket {
				inDouble = !inDouble
			}
		case '`':
			if !inSingle && !inDouble && !inBracket {
				inBacktick = !inBacktick
			}
		case '[':
			if !inSingle && !inDouble && !inBacktick {
				inBracket = true
			}
		case ']':
			if inBracket && !inSingle && !inDouble && !inBacktick {
				inBracket = false
			}
		}

		if inSingle || inDouble || inBacktick || inBracket {
			continue
		}

		switch char {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return raw[1:index], raw[index+1:], nil
			}
		}
	}

	return "", "", fmt.Errorf("parenthesized segment is incomplete")
}

func splitCommaAware(raw string) []string {
	parts := make([]string, 0)
	current := strings.Builder{}
	depth := 0
	inSingle := false
	inDouble := false
	inBacktick := false
	inBracket := false

	for _, char := range raw {
		switch char {
		case '\'':
			if !inDouble && !inBacktick && !inBracket {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle && !inBacktick && !inBracket {
				inDouble = !inDouble
			}
		case '`':
			if !inSingle && !inDouble && !inBracket {
				inBacktick = !inBacktick
			}
		case '[':
			if !inSingle && !inDouble && !inBacktick {
				inBracket = true
			}
		case ']':
			if inBracket && !inSingle && !inDouble && !inBacktick {
				inBracket = false
			}
		}

		if !inSingle && !inDouble && !inBacktick && !inBracket {
			switch char {
			case '(':
				depth++
			case ')':
				if depth > 0 {
					depth--
				}
			case ',':
				if depth == 0 {
					parts = append(parts, strings.TrimSpace(current.String()))
					current.Reset()
					continue
				}
			}
		}

		current.WriteRune(char)
	}

	if trailing := strings.TrimSpace(current.String()); trailing != "" {
		parts = append(parts, trailing)
	}

	return parts
}

func splitDefinitionTokens(raw string) []string {
	tokens := make([]string, 0)
	current := strings.Builder{}
	depth := 0
	inSingle := false
	inDouble := false
	inBacktick := false
	inBracket := false

	flush := func() {
		if value := strings.TrimSpace(current.String()); value != "" {
			tokens = append(tokens, value)
		}
		current.Reset()
	}

	for _, char := range raw {
		switch char {
		case '\'':
			if !inDouble && !inBacktick && !inBracket {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle && !inBacktick && !inBracket {
				inDouble = !inDouble
			}
		case '`':
			if !inSingle && !inDouble && !inBracket {
				inBacktick = !inBacktick
			}
		case '[':
			if !inSingle && !inDouble && !inBacktick {
				inBracket = true
			}
		case ']':
			if inBracket && !inSingle && !inDouble && !inBacktick {
				inBracket = false
			}
		}

		if !inSingle && !inDouble && !inBacktick && !inBracket {
			switch char {
			case '(':
				depth++
			case ')':
				if depth > 0 {
					depth--
				}
			}
			if unicode.IsSpace(char) && depth == 0 {
				flush()
				continue
			}
		}

		current.WriteRune(char)
	}

	flush()
	return tokens
}

func indexKeywordOutsideStructured(raw, keyword string) int {
	upper := strings.ToUpper(raw)
	target := strings.ToUpper(keyword)
	depth := 0
	inSingle := false
	inDouble := false
	inBacktick := false
	inBracket := false

	for index, char := range upper {
		switch char {
		case '\'':
			if !inDouble && !inBacktick && !inBracket {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle && !inBacktick && !inBracket {
				inDouble = !inDouble
			}
		case '`':
			if !inSingle && !inDouble && !inBracket {
				inBacktick = !inBacktick
			}
		case '[':
			if !inSingle && !inDouble && !inBacktick {
				inBracket = true
			}
		case ']':
			if inBracket && !inSingle && !inDouble && !inBacktick {
				inBracket = false
			}
		}

		if inSingle || inDouble || inBacktick || inBracket {
			continue
		}

		switch char {
		case '(':
			depth++
		case ')':
			if depth > 0 {
				depth--
			}
		}

		if depth == 0 && strings.HasPrefix(upper[index:], target) {
			return index
		}
	}

	return -1
}

func indexOfRuneOutsideQuoted(raw string, target rune) int {
	inSingle := false
	inDouble := false
	inBacktick := false
	inBracket := false

	for index, char := range raw {
		switch char {
		case '\'':
			if !inDouble && !inBacktick && !inBracket {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle && !inBacktick && !inBracket {
				inDouble = !inDouble
			}
		case '`':
			if !inSingle && !inDouble && !inBracket {
				inBacktick = !inBacktick
			}
		case '[':
			if !inSingle && !inDouble && !inBacktick {
				inBracket = true
			}
		case ']':
			if inBracket && !inSingle && !inDouble && !inBacktick {
				inBracket = false
			}
		default:
			if !inSingle && !inDouble && !inBacktick && !inBracket && char == target {
				return index
			}
		}
	}
	return -1
}

func detectCSVDelimiter(raw string) rune {
	candidates := []rune{',', ';', '\t', '|'}
	lines := strings.Split(raw, "\n")
	if len(lines) > 5 {
		lines = lines[:5]
	}

	bestDelimiter := ','
	bestScore := -1
	for _, delimiter := range candidates {
		score := 0
		for _, line := range lines {
			score += strings.Count(line, string(delimiter))
		}
		if score > bestScore {
			bestDelimiter = delimiter
			bestScore = score
		}
	}
	return bestDelimiter
}

func normalizeQualifiedIdentifier(raw, fallback string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return sanitizeSetupIdentifier(fallback, fallback)
	}

	parts := strings.Split(trimmed, ".")
	last := parts[len(parts)-1]
	last = strings.TrimSpace(last)
	last = strings.Trim(last, "\"`[]")
	return sanitizeSetupIdentifier(last, fallback)
}

func sanitizeSetupIdentifier(raw, fallback string) string {
	trimmed := strings.TrimSpace(strings.Trim(raw, "\"`[]"))
	if trimmed == "" {
		trimmed = fallback
	}

	var builder strings.Builder
	lastUnderscore := false
	for _, char := range strings.ToLower(trimmed) {
		switch {
		case (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9'):
			builder.WriteRune(char)
			lastUnderscore = false
		default:
			if !lastUnderscore {
				builder.WriteRune('_')
				lastUnderscore = true
			}
		}
	}

	result := strings.Trim(builder.String(), "_")
	if result == "" {
		result = strings.TrimSpace(fallback)
	}
	if result == "" {
		result = "imported_value"
	}
	if result[0] >= '0' && result[0] <= '9' {
		result = "n_" + result
	}
	if !data.IsValidIdentifier(result) {
		result = "imported_" + strings.Trim(result, "_")
	}
	if len(result) > 63 {
		result = result[:63]
	}
	return result
}

func uniqueSanitizedIdentifiers(values []string, fallbackPrefix string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]int)
	for index, value := range values {
		base := sanitizeSetupIdentifier(value, fmt.Sprintf("%s_%d", fallbackPrefix, index+1))
		count := seen[base]
		seen[base] = count + 1
		if count == 0 {
			result = append(result, base)
			continue
		}
		result = append(result, fmt.Sprintf("%s_%d", base, count+1))
	}
	return result
}

func normalizeOzyType(raw string) string {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" {
		return "text"
	}
	if normalized == "bool" {
		return "boolean"
	}
	if _, ok := data.TypeMapping[normalized]; ok {
		return normalized
	}
	return "text"
}

func buildSetupDisplayName(name string) string {
	parts := strings.Split(strings.ReplaceAll(name, "_", " "), " ")
	for index, part := range parts {
		if part == "" {
			continue
		}
		parts[index] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
	}
	return strings.Join(parts, " ")
}

func summarizeSQLStatement(statement string) string {
	trimmed := strings.TrimSpace(statement)
	if len(trimmed) <= 72 {
		return trimmed
	}
	return trimmed[:69] + "..."
}

func allStringsMatch(values []string, predicate func(string) bool) bool {
	for _, value := range values {
		if !predicate(value) {
			return false
		}
	}
	return true
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func isSQLConstraintKeyword(token string) bool {
	switch token {
	case "NOT", "NULL", "PRIMARY", "UNIQUE", "DEFAULT", "REFERENCES", "CONSTRAINT", "CHECK", "COLLATE", "GENERATED", "IDENTITY", "AUTO_INCREMENT", "WITH", "ON", "KEY":
		return true
	default:
		return false
	}
}

func looksLikeSQLitePrimaryKey(typeExpression, remainder string) bool {
	return strings.Contains(strings.ToUpper(typeExpression), "INTEGER") && strings.Contains(remainder, "PRIMARY KEY")
}

func isBooleanLikeString(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "false", "t", "f", "1", "0", "yes", "no", "y", "n":
		return true
	default:
		return false
	}
}

func isIntegerString(value string) bool {
	if value == "" {
		return false
	}
	_, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	return err == nil
}

func isNumericString(value string) bool {
	if value == "" {
		return false
	}
	_, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	return err == nil
}

func isUUIDLikeString(value string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	if len(trimmed) != 36 {
		return false
	}
	for index, char := range trimmed {
		switch index {
		case 8, 13, 18, 23:
			if char != '-' {
				return false
			}
		default:
			if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
				return false
			}
		}
	}
	return true
}

func isDateLikeString(value string) bool {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) != 10 {
		return false
	}
	for index, char := range trimmed {
		switch index {
		case 4, 7:
			if char != '-' {
				return false
			}
		default:
			if char < '0' || char > '9' {
				return false
			}
		}
	}
	return true
}

func isTimestampLikeString(value string) bool {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) < 19 {
		return false
	}
	if !isDateLikeString(trimmed[:10]) {
		return false
	}
	separator := trimmed[10]
	return separator == 'T' || separator == ' '
}
