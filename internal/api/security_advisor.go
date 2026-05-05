package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/logger"
	"github.com/dop251/goja"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

type securityAdvisorTableScan struct {
	Schema         string   `json:"schema"`
	TableName      string   `json:"table_name"`
	Category       string   `json:"category"`
	IsSystem       bool     `json:"is_system"`
	RLSStatus      string   `json:"rls_status"`
	PolicyCount    int      `json:"policy_count"`
	PermissiveRead bool     `json:"permissive_read"`
	UsesAuthUID    bool     `json:"uses_auth_uid"`
	Sensitive      bool     `json:"sensitive"`
	RiskLevel      string   `json:"risk_level"`
	RiskReasons    []string `json:"risk_reasons"`
	RecommendedFix string   `json:"recommended_fix"`
}

type securityAdvisorInfraScan struct {
	SlotName      string `json:"slot_name"`
	DatabaseName  string `json:"database_name"`
	Plugin        string `json:"plugin"`
	Active        bool   `json:"active"`
	RetainedBytes int64  `json:"retained_bytes"`
	LikelyOrphan  bool   `json:"likely_orphan"`
}

type securityAdvisorScanSummary struct {
	RiskScore           int `json:"risk_score"`
	TotalTables         int `json:"total_tables"`
	VulnerableTables    int `json:"vulnerable_tables"`
	PermissivePolicies  int `json:"permissive_policies"`
	SensitiveWithoutUID int `json:"sensitive_without_uid"`
	LikelyOrphanedSlots int `json:"likely_orphaned_slots"`
}

type securityAdvisorFixResult struct {
	TableName string `json:"table_name"`
	Action    string `json:"action"`
	Status    string `json:"status"`
	Message   string `json:"message,omitempty"`
}

func (h *Handler) GetSecurityAdvisorScan(c echo.Context) (err error) {
	defer func() {
		if r := recover(); r != nil {
			c.Logger().Errorf("panic in GetSecurityAdvisorScan: %v", r)
			if !c.Response().Committed {
				err = c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to scan security advisor"})
			}
		}
	}()

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	tables, err := h.scanSecurityAdvisorTables(ctx)
	if err != nil {
		c.Logger().Errorf("advisor tables scan failed: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	infra, err := h.scanSecurityAdvisorInfra(ctx)
	if err != nil {
		if isRecoverableAdvisorInfraError(err) {
			c.Logger().Warnf("advisor infra scan partially unavailable: %v", err)
			infra = []securityAdvisorInfraScan{}
		} else {
			c.Logger().Errorf("advisor infra scan failed: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
	}

	summary := buildSecurityAdvisorSummary(tables, infra)
	suggestions := buildSecurityAdvisorSuggestionsWithGoja(tables)
	for _, suggestion := range suggestions {
		logger.Log.Info().
			Str("area", "security_advisor").
			Str("kind", "goja_suggestion").
			Str("message", suggestion).
			Msg("advisor suggestion")
	}
	response := map[string]any{
		"summary": summary,
		"tables":  tables,
		"infra":   infra,
		"suggestions": suggestions,
	}
	if err != nil {
		response["infra_warning"] = "infrastructure scan partially unavailable"
	}
	return c.JSON(http.StatusOK, response)
}

func isRecoverableAdvisorInfraError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "permission denied") ||
		strings.Contains(msg, "pg_replication_slots") ||
		strings.Contains(msg, "pg_wal_lsn_diff") ||
		strings.Contains(msg, "insufficient privilege")
}

func (h *Handler) FixSecurityAdvisor(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
	defer cancel()

	var req struct {
		DryRun bool     `json:"dry_run"`
		Tables []string `json:"tables"`
	}
	_ = c.Bind(&req)

	scanRows, err := h.scanSecurityAdvisorTables(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to read advisor scan before fix"})
	}

	selected := map[string]struct{}{}
	for _, table := range req.Tables {
		normalized := strings.TrimSpace(strings.ToLower(table))
		if normalized == "" {
			continue
		}
		selected[normalized] = struct{}{}
	}

	candidates := make([]securityAdvisorTableScan, 0, len(scanRows))
	for _, row := range scanRows {
		if row.RLSStatus == "PROTECTED" {
			continue
		}
		if row.Category == "system" {
			continue
		}
		qualified := securityAdvisorQualifiedName(row.Schema, row.TableName)
		if len(selected) > 0 {
			if _, ok := selected[strings.ToLower(row.TableName)]; !ok {
				if _, ok := selected[strings.ToLower(qualified)]; !ok {
					continue
				}
			}
		}
		if !data.IsValidIdentifier(strings.TrimSpace(row.Schema)) || !data.IsValidIdentifier(strings.TrimSpace(row.TableName)) {
			continue
		}
		candidates = append(candidates, row)
	}

	if req.DryRun {
		results := make([]securityAdvisorFixResult, 0, len(candidates))
		for _, row := range candidates {
			results = append(results, securityAdvisorFixResult{TableName: securityAdvisorQualifiedName(row.Schema, row.TableName), Action: "ENABLE_RLS", Status: "preview"})
		}
		return c.JSON(http.StatusOK, map[string]any{"dry_run": true, "results": results, "count": len(results)})
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start advisor fix transaction"})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	results := make([]securityAdvisorFixResult, 0, len(candidates))
	for _, row := range candidates {
		schema := strings.TrimSpace(row.Schema)
		table := strings.TrimSpace(row.TableName)
		qualified := securityAdvisorQualifiedName(schema, table)
		if !data.IsValidIdentifier(schema) || !data.IsValidIdentifier(table) {
			results = append(results, securityAdvisorFixResult{TableName: qualified, Action: "ENABLE_RLS", Status: "skipped", Message: "invalid schema or table name"})
			continue
		}
		if err := enableRLSOnQualifiedTable(ctx, tx, schema, table); err != nil {
			results = append(results, securityAdvisorFixResult{TableName: qualified, Action: "ENABLE_RLS", Status: "failed", Message: err.Error()})
			continue
		}
		results = append(results, securityAdvisorFixResult{TableName: qualified, Action: "ENABLE_RLS", Status: "applied"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit advisor fixes"})
	}

	return c.JSON(http.StatusOK, map[string]any{"dry_run": false, "results": results, "count": len(results)})
}

func (h *Handler) scanSecurityAdvisorTables(ctx context.Context) ([]securityAdvisorTableScan, error) {
	type row struct {
		schemaName    string
		tableName     string
		rlsEnabled    bool
		policyCount   int
		permissiveAny bool
		usesAuthUID   bool
	}

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT
			n.nspname AS schema_name,
			c.relname AS table_name,
			c.relrowsecurity AS rls_enabled,
			COALESCE(p.policy_count, 0) AS policy_count,
			COALESCE(p.permissive_any, false) AS permissive_any,
			COALESCE(p.uses_auth_uid, false) AS uses_auth_uid
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN (
			SELECT
				pol.polrelid,
				COUNT(*) AS policy_count,
				BOOL_OR(
					(pol.polcmd IN ('r', '*'))
					AND (
						lower(trim(regexp_replace(coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''), '[()\\s]+', '', 'g'))) = 'true'
					)
				) AS permissive_any,
				BOOL_OR(position('auth.uid()' in lower(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))) > 0) AS uses_auth_uid
			FROM pg_policy pol
			GROUP BY pol.polrelid
		) p ON p.polrelid = c.oid
		WHERE c.relkind = 'r'
		  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'auth', 'ozy_internal')
		  AND c.relname NOT LIKE '!_v!_%' ESCAPE '!'
		  AND c.relname NOT LIKE '!_ozy!_%' ESCAPE '!'
		ORDER BY c.relrowsecurity ASC, c.relname ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]securityAdvisorTableScan, 0, 32)
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.schemaName, &r.tableName, &r.rlsEnabled, &r.policyCount, &r.permissiveAny, &r.usesAuthUID); err != nil {
			return nil, err
		}
		category := categorizeSchema(r.schemaName)
		status := "PROTECTED"
		if !r.rlsEnabled {
			status = "VULNERABLE"
		}
		sensitive := isSensitiveTableName(r.tableName)
		reasons := buildTableRiskReasons(r.rlsEnabled, r.permissiveAny, r.usesAuthUID, sensitive)
		risk := classifyRiskLevel(reasons)
		fix := "none"
		if !r.rlsEnabled {
			fix = "ALTER TABLE ... ENABLE ROW LEVEL SECURITY"
		} else if r.permissiveAny {
			fix = "replace permissive SELECT true policy"
		}
		out = append(out, securityAdvisorTableScan{
			Schema:         r.schemaName,
			TableName:      r.tableName,
			Category:       category,
			IsSystem:       category == "system",
			RLSStatus:      status,
			PolicyCount:    r.policyCount,
			PermissiveRead: r.permissiveAny,
			UsesAuthUID:    r.usesAuthUID,
			Sensitive:      sensitive,
			RiskLevel:      risk,
			RiskReasons:    reasons,
			RecommendedFix: fix,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (h *Handler) scanSecurityAdvisorInfra(ctx context.Context) ([]securityAdvisorInfraScan, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT
			slot_name,
			COALESCE(database, ''),
			COALESCE(plugin, ''),
			active,
			COALESCE(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::bigint, 0)
		FROM pg_replication_slots
		WHERE slot_type = 'logical'
		  AND temporary = false
		ORDER BY active ASC, slot_name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]securityAdvisorInfraScan, 0, 8)
	for rows.Next() {
		var item securityAdvisorInfraScan
		if err := rows.Scan(&item.SlotName, &item.DatabaseName, &item.Plugin, &item.Active, &item.RetainedBytes); err != nil {
			return nil, err
		}
		item.LikelyOrphan = !item.Active && item.RetainedBytes > 256*1024*1024
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func buildSecurityAdvisorSummary(tables []securityAdvisorTableScan, infra []securityAdvisorInfraScan) securityAdvisorScanSummary {
	summary := securityAdvisorScanSummary{TotalTables: len(tables)}
	riskPenalty := 0
	for _, row := range tables {
		if row.Category == "system" {
			continue
		}
		if row.RLSStatus == "VULNERABLE" {
			summary.VulnerableTables++
			riskPenalty += 25
		}
		if row.PermissiveRead {
			summary.PermissivePolicies++
			riskPenalty += 15
		}
		if row.Sensitive && !row.UsesAuthUID {
			summary.SensitiveWithoutUID++
			riskPenalty += 10
		}
	}
	for _, slot := range infra {
		if slot.LikelyOrphan {
			summary.LikelyOrphanedSlots++
			riskPenalty += 5
		}
	}
	summary.RiskScore = 100 - riskPenalty
	if summary.RiskScore < 0 {
		summary.RiskScore = 0
	}
	if summary.RiskScore > 100 {
		summary.RiskScore = 100
	}
	return summary
}

func isSensitiveTableName(name string) bool {
	value := strings.ToLower(strings.TrimSpace(name))
	if value == "" {
		return false
	}
	keywords := []string{"user", "billing", "payment", "secret", "token", "credential", "key", "invoice"}
	for _, keyword := range keywords {
		if strings.Contains(value, keyword) {
			return true
		}
	}
	return false
}

func buildTableRiskReasons(rlsEnabled bool, permissiveAny bool, usesAuthUID bool, sensitive bool) []string {
	reasons := make([]string, 0, 3)
	if !rlsEnabled {
		reasons = append(reasons, "RLS_DISABLED")
	}
	if permissiveAny {
		reasons = append(reasons, "PERMISSIVE_SELECT_TRUE")
	}
	if sensitive && !usesAuthUID {
		reasons = append(reasons, "SENSITIVE_NO_AUTH_UID")
	}
	sort.Strings(reasons)
	return reasons
}

func classifyRiskLevel(reasons []string) string {
	switch len(reasons) {
	case 0:
		return "low"
	case 1:
		return "medium"
	default:
		return "high"
	}
}

func categorizeSchema(schemaName string) string {
	schema := strings.ToLower(strings.TrimSpace(schemaName))
	if schema == "" {
		return "user"
	}

	if _, ok := securityAdvisorSystemSchemas[schema]; ok {
		return "system"
	}
	if strings.HasPrefix(schema, "supabase_") || strings.HasPrefix(schema, "pg_") {
		return "system"
	}
	return "user"
}

var securityAdvisorSystemSchemas = map[string]struct{}{
	"pg_catalog":          {},
	"information_schema":  {},
	"auth":                {},
	"ozy_internal":        {},
	"storage":             {},
	"realtime":            {},
	"_realtime":           {},
	"vault":               {},
	"net":                 {},
	"supabase_functions":  {},
	"supabase_migrations": {},
}

func securityAdvisorQualifiedName(schema, table string) string {
	schemaName := strings.TrimSpace(schema)
	tableName := strings.TrimSpace(table)
	if schemaName == "" {
		return tableName
	}
	return schemaName + "." + tableName
}

func enableRLSOnQualifiedTable(ctx context.Context, tx pgx.Tx, schema, table string) error {
	if !data.IsValidIdentifier(schema) || !data.IsValidIdentifier(table) {
		return fmt.Errorf("invalid schema or table name")
	}
	qualified := data.QuoteIdentifier(schema) + "." + data.QuoteIdentifier(table)
	_, err := tx.Exec(ctx, "ALTER TABLE "+qualified+" ENABLE ROW LEVEL SECURITY")
	return err
}

func buildSecurityAdvisorSuggestionsWithGoja(tables []securityAdvisorTableScan) []string {
	vm := goja.New()
	findings := make([]map[string]any, 0, len(tables))
	for _, row := range tables {
		if row.Category != "user" {
			continue
		}
		findings = append(findings, map[string]any{
			"schema":       row.Schema,
			"table_name":   row.TableName,
			"risk_reasons": row.RiskReasons,
		})
	}

	raw, err := json.Marshal(findings)
	if err != nil {
		return []string{}
	}

	script := `
var findings = ` + string(raw) + `;
var suggestions = [];
for (var i = 0; i < findings.length; i++) {
  var issue = findings[i] || {};
  var reasons = issue.risk_reasons || [];
	  if (issue.schema === 'public' && reasons.indexOf('RLS_DISABLED') >= 0) {
	    suggestions.push("Sugerencia de Seguridad: La tabla '" + issue.schema + "." + issue.table_name + "' está expuesta. Activa RLS para protegerla.");
	  }
}
suggestions;
`

	value, err := vm.RunString(script)
	if err != nil {
		return []string{}
	}

	exported := value.Export()
	rawSuggestions, ok := exported.([]any)
	if !ok {
		if single, ok := exported.([]interface{}); ok {
			rawSuggestions = single
		} else {
			return []string{}
		}
	}

	out := make([]string, 0, len(rawSuggestions))
	for _, item := range rawSuggestions {
		if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}
