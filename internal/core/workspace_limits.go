package core

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
)

const (
	workspaceUsageWindowDays                  = 30
	defaultWorkspaceWarningThresholdPct       = 80
	defaultWorkspaceRowsHardLimit       int64 = 0
	defaultWorkspaceStorageHardLimit    int64 = 0
	defaultWorkspaceRateWindowSeconds   int64 = 60
)

type WorkspaceLimits struct {
	WarningThresholdPct      int64 `json:"warning_threshold_pct"`
	RowsHardLimit            int64 `json:"rows_hard_limit"`
	StorageBytesHardLimit    int64 `json:"storage_bytes_hard_limit"`
	APIRequestsSoftLimit     int64 `json:"api_requests_soft_limit"`
	APIRequestsHardLimit     int64 `json:"api_requests_hard_limit"`
	RealtimeEventsSoftLimit  int64 `json:"realtime_events_soft_limit"`
	RealtimeEventsHardLimit  int64 `json:"realtime_events_hard_limit"`
	FunctionInvocationsLimit int64 `json:"function_invocations_soft_limit"`
	FunctionInvocationsHard  int64 `json:"function_invocations_hard_limit"`
	RateLimitWindowSeconds   int64 `json:"rate_limit_window_seconds"`
}

type WorkspaceUsageWarning struct {
	Metric   string  `json:"metric"`
	Current  int64   `json:"current"`
	Limit    int64   `json:"limit"`
	Severity string  `json:"severity"`
	UsagePct float64 `json:"usage_pct"`
}

type WorkspaceUsage struct {
	WorkspaceID         string                  `json:"workspace_id"`
	Window              string                  `json:"window"`
	WindowStartedAt     time.Time               `json:"window_started_at"`
	Rows                int64                   `json:"rows"`
	StorageBytes        int64                   `json:"storage_bytes"`
	APIRequests         int64                   `json:"api_requests"`
	RealtimeEvents      int64                   `json:"realtime_events"`
	FunctionInvocations int64                   `json:"function_invocations"`
	Warnings            []WorkspaceUsageWarning `json:"warnings"`
}

type WorkspaceLimitExceededError struct {
	Metric   string
	Current  int64
	Incoming int64
	Limit    int64
}

type WorkspaceRateLimitExceededError struct {
	Metric        string
	Current       int64
	Incoming      int64
	Limit         int64
	WindowSeconds int64
	RetryAfter    int64
}

func (e *WorkspaceLimitExceededError) Error() string {
	switch e.Metric {
	case "storage_bytes":
		return fmt.Sprintf("project storage limit exceeded: %d bytes used + %d incoming > %d limit", e.Current, e.Incoming, e.Limit)
	case "rows":
		return fmt.Sprintf("project row limit exceeded: %d rows used + %d incoming > %d limit", e.Current, e.Incoming, e.Limit)
	default:
		return fmt.Sprintf("project %s limit exceeded: %d current + %d incoming > %d limit", e.Metric, e.Current, e.Incoming, e.Limit)
	}
}

func (e *WorkspaceRateLimitExceededError) Error() string {
	return fmt.Sprintf("workspace %s request rate limit exceeded: %d current + %d incoming > %d limit in %ds window", e.Metric, e.Current, e.Incoming, e.Limit, e.WindowSeconds)
}

func defaultWorkspaceLimits() WorkspaceLimits {
	return WorkspaceLimits{
		WarningThresholdPct:      defaultWorkspaceWarningThresholdPct,
		RowsHardLimit:            defaultWorkspaceRowsHardLimit,
		StorageBytesHardLimit:    defaultWorkspaceStorageHardLimit,
		APIRequestsSoftLimit:     0,
		APIRequestsHardLimit:     0,
		RealtimeEventsSoftLimit:  0,
		RealtimeEventsHardLimit:  0,
		FunctionInvocationsLimit: 0,
		FunctionInvocationsHard:  0,
		RateLimitWindowSeconds:   defaultWorkspaceRateWindowSeconds,
	}
}

func normalizeWorkspaceLimits(input WorkspaceLimits) WorkspaceLimits {
	limits := input
	if limits.WarningThresholdPct <= 0 {
		limits.WarningThresholdPct = defaultWorkspaceWarningThresholdPct
	}
	if limits.WarningThresholdPct > 100 {
		limits.WarningThresholdPct = 100
	}
	if limits.RowsHardLimit < 0 {
		limits.RowsHardLimit = 0
	}
	if limits.StorageBytesHardLimit < 0 {
		limits.StorageBytesHardLimit = 0
	}
	if limits.APIRequestsSoftLimit < 0 {
		limits.APIRequestsSoftLimit = 0
	}
	if limits.APIRequestsHardLimit < 0 {
		limits.APIRequestsHardLimit = 0
	}
	if limits.RealtimeEventsSoftLimit < 0 {
		limits.RealtimeEventsSoftLimit = 0
	}
	if limits.RealtimeEventsHardLimit < 0 {
		limits.RealtimeEventsHardLimit = 0
	}
	if limits.FunctionInvocationsLimit < 0 {
		limits.FunctionInvocationsLimit = 0
	}
	if limits.FunctionInvocationsHard < 0 {
		limits.FunctionInvocationsHard = 0
	}
	if limits.RateLimitWindowSeconds <= 0 {
		limits.RateLimitWindowSeconds = defaultWorkspaceRateWindowSeconds
	}
	if limits.RateLimitWindowSeconds > 86400 {
		limits.RateLimitWindowSeconds = 86400
	}
	return limits
}

func workspaceConfigAsMap(raw any) map[string]any {
	switch typed := raw.(type) {
	case nil:
		return map[string]any{}
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, value := range typed {
			out[key] = value
		}
		return out
	case []byte:
		var decoded map[string]any
		if err := json.Unmarshal(typed, &decoded); err == nil && decoded != nil {
			return decoded
		}
	case string:
		var decoded map[string]any
		if err := json.Unmarshal([]byte(typed), &decoded); err == nil && decoded != nil {
			return decoded
		}
	}
	return map[string]any{}
}

func readInt64ConfigValue(raw any) int64 {
	switch value := raw.(type) {
	case nil:
		return 0
	case int64:
		return value
	case int32:
		return int64(value)
	case int:
		return int64(value)
	case float64:
		return int64(math.Round(value))
	case float32:
		return int64(math.Round(float64(value)))
	case json.Number:
		if parsed, err := value.Int64(); err == nil {
			return parsed
		}
	case string:
		if parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64); err == nil {
			return parsed
		}
	}
	return 0
}

func workspaceLimitsFromConfig(raw any) WorkspaceLimits {
	config := workspaceConfigAsMap(raw)
	limitsRaw, ok := config["limits"]
	if !ok {
		return defaultWorkspaceLimits()
	}
	limitsMap := workspaceConfigAsMap(limitsRaw)
	limits := defaultWorkspaceLimits()
	limits.WarningThresholdPct = readInt64ConfigValue(limitsMap["warning_threshold_pct"])
	limits.RowsHardLimit = readInt64ConfigValue(limitsMap["rows_hard_limit"])
	limits.StorageBytesHardLimit = readInt64ConfigValue(limitsMap["storage_bytes_hard_limit"])
	limits.APIRequestsSoftLimit = readInt64ConfigValue(limitsMap["api_requests_soft_limit"])
	limits.APIRequestsHardLimit = readInt64ConfigValue(limitsMap["api_requests_hard_limit"])
	limits.RealtimeEventsSoftLimit = readInt64ConfigValue(limitsMap["realtime_events_soft_limit"])
	limits.RealtimeEventsHardLimit = readInt64ConfigValue(limitsMap["realtime_events_hard_limit"])
	limits.FunctionInvocationsLimit = readInt64ConfigValue(limitsMap["function_invocations_soft_limit"])
	if limits.FunctionInvocationsLimit == 0 {
		limits.FunctionInvocationsLimit = readInt64ConfigValue(limitsMap["function_invocations_limit"])
	}
	limits.FunctionInvocationsHard = readInt64ConfigValue(limitsMap["function_invocations_hard_limit"])
	limits.RateLimitWindowSeconds = readInt64ConfigValue(limitsMap["rate_limit_window_seconds"])
	return normalizeWorkspaceLimits(limits)
}

func encodeWorkspaceLimits(limits WorkspaceLimits) map[string]any {
	normalized := normalizeWorkspaceLimits(limits)
	return map[string]any{
		"warning_threshold_pct":           normalized.WarningThresholdPct,
		"rows_hard_limit":                 normalized.RowsHardLimit,
		"storage_bytes_hard_limit":        normalized.StorageBytesHardLimit,
		"api_requests_soft_limit":         normalized.APIRequestsSoftLimit,
		"api_requests_hard_limit":         normalized.APIRequestsHardLimit,
		"realtime_events_soft_limit":      normalized.RealtimeEventsSoftLimit,
		"realtime_events_hard_limit":      normalized.RealtimeEventsHardLimit,
		"function_invocations_soft_limit": normalized.FunctionInvocationsLimit,
		"function_invocations_hard_limit": normalized.FunctionInvocationsHard,
		"rate_limit_window_seconds":       normalized.RateLimitWindowSeconds,
	}
}

func workspaceLimitWarnings(usage WorkspaceUsage, limits WorkspaceLimits) []WorkspaceUsageWarning {
	warnings := make([]WorkspaceUsageWarning, 0, 5)
	threshold := float64(normalizeWorkspaceLimits(limits).WarningThresholdPct)

	push := func(metric string, current, limit int64, hard bool) {
		if limit <= 0 {
			return
		}
		pct := (float64(current) / float64(limit)) * 100
		if pct < threshold {
			return
		}
		severity := "warning"
		if hard && current >= limit {
			severity = "critical"
		}
		if !hard && current >= limit {
			severity = "critical"
		}
		warnings = append(warnings, WorkspaceUsageWarning{
			Metric:   metric,
			Current:  current,
			Limit:    limit,
			Severity: severity,
			UsagePct: pct,
		})
	}

	push("rows", usage.Rows, limits.RowsHardLimit, true)
	push("storage_bytes", usage.StorageBytes, limits.StorageBytesHardLimit, true)
	push("api_requests", usage.APIRequests, limits.APIRequestsSoftLimit, false)
	push("api_requests_hard", usage.APIRequests, limits.APIRequestsHardLimit, true)
	push("realtime_events", usage.RealtimeEvents, limits.RealtimeEventsSoftLimit, false)
	push("realtime_events_hard", usage.RealtimeEvents, limits.RealtimeEventsHardLimit, true)
	push("function_invocations", usage.FunctionInvocations, limits.FunctionInvocationsLimit, false)
	push("function_invocations_hard", usage.FunctionInvocations, limits.FunctionInvocationsHard, true)

	return warnings
}

func (s *WorkspaceService) GetWorkspaceLimits(ctx context.Context, workspaceID string) (WorkspaceLimits, error) {
	var rawConfig any
	if err := s.db.Pool.QueryRow(ctx, `SELECT config FROM _v_workspaces WHERE id = $1`, workspaceID).Scan(&rawConfig); err != nil {
		return WorkspaceLimits{}, err
	}
	return workspaceLimitsFromConfig(rawConfig), nil
}

func (s *WorkspaceService) UpdateWorkspaceLimits(ctx context.Context, workspaceID string, limits WorkspaceLimits) error {
	var rawConfig any
	if err := s.db.Pool.QueryRow(ctx, `SELECT config FROM _v_workspaces WHERE id = $1`, workspaceID).Scan(&rawConfig); err != nil {
		return err
	}
	config := workspaceConfigAsMap(rawConfig)
	config["limits"] = encodeWorkspaceLimits(limits)
	_, err := s.db.Pool.Exec(ctx, `
		UPDATE _v_workspaces
		SET config = $1, updated_at = NOW()
		WHERE id = $2
	`, config, workspaceID)
	return err
}

func (s *WorkspaceService) GetWorkspaceUsage(ctx context.Context, workspaceID string) (WorkspaceUsage, error) {
	usage := WorkspaceUsage{
		WorkspaceID:     workspaceID,
		Window:          "rolling_30d",
		WindowStartedAt: time.Now().UTC().AddDate(0, 0, -workspaceUsageWindowDays),
		Warnings:        []WorkspaceUsageWarning{},
	}

	rows, err := s.db.Pool.Query(ctx, `
		SELECT name
		FROM _v_collections
		WHERE workspace_id = $1
		  AND name NOT LIKE '\_v\_%' ESCAPE '\'
		  AND name NOT LIKE '\_ozy\_%' ESCAPE '\'
		ORDER BY name ASC
	`, workspaceID)
	if err != nil {
		return usage, err
	}
	defer rows.Close()

	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err != nil {
			return usage, err
		}
		count, err := s.countWorkspaceTableRows(ctx, tableName)
		if err != nil {
			return usage, err
		}
		usage.Rows += count
	}
	if err := rows.Err(); err != nil {
		return usage, err
	}

	if err := s.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(size), 0)
		FROM _v_storage_objects
		WHERE workspace_id = $1
	`, workspaceID).Scan(&usage.StorageBytes); err != nil {
		return usage, err
	}

	if err := s.db.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE created_at >= $2),
			COUNT(*) FILTER (WHERE created_at >= $2 AND path LIKE '/api/realtime%'),
			COUNT(*) FILTER (WHERE created_at >= $2 AND path LIKE '/api/functions/%/invoke%')
		FROM _v_audit_logs
		WHERE workspace_id = $1
	`, workspaceID, usage.WindowStartedAt).Scan(&usage.APIRequests, &usage.RealtimeEvents, &usage.FunctionInvocations); err != nil {
		return usage, err
	}

	limits, err := s.GetWorkspaceLimits(ctx, workspaceID)
	if err != nil {
		return usage, err
	}
	usage.Warnings = workspaceLimitWarnings(usage, limits)
	return usage, nil
}

func (s *WorkspaceService) EnforceRowLimit(ctx context.Context, workspaceID string, additionalRows int64) error {
	if strings.TrimSpace(workspaceID) == "" || additionalRows <= 0 {
		return nil
	}
	limits, err := s.GetWorkspaceLimits(ctx, workspaceID)
	if err != nil {
		return err
	}
	if limits.RowsHardLimit <= 0 {
		return nil
	}
	usage, err := s.GetWorkspaceUsage(ctx, workspaceID)
	if err != nil {
		return err
	}
	if usage.Rows+additionalRows > limits.RowsHardLimit {
		return &WorkspaceLimitExceededError{
			Metric:   "rows",
			Current:  usage.Rows,
			Incoming: additionalRows,
			Limit:    limits.RowsHardLimit,
		}
	}
	return nil
}

func (s *WorkspaceService) EnforceStorageLimit(ctx context.Context, workspaceID string, additionalBytes int64) error {
	if strings.TrimSpace(workspaceID) == "" || additionalBytes <= 0 {
		return nil
	}
	limits, err := s.GetWorkspaceLimits(ctx, workspaceID)
	if err != nil {
		return err
	}
	if limits.StorageBytesHardLimit <= 0 {
		return nil
	}
	usage, err := s.GetWorkspaceUsage(ctx, workspaceID)
	if err != nil {
		return err
	}
	if usage.StorageBytes+additionalBytes > limits.StorageBytesHardLimit {
		return &WorkspaceLimitExceededError{
			Metric:   "storage_bytes",
			Current:  usage.StorageBytes,
			Incoming: additionalBytes,
			Limit:    limits.StorageBytesHardLimit,
		}
	}
	return nil
}

func (s *WorkspaceService) EnforceRequestRateLimit(ctx context.Context, workspaceID, metric string, incoming int64) error {
	workspaceID = strings.TrimSpace(workspaceID)
	metric = strings.TrimSpace(strings.ToLower(metric))
	if workspaceID == "" || incoming <= 0 {
		return nil
	}

	limits, err := s.GetWorkspaceLimits(ctx, workspaceID)
	if err != nil {
		return err
	}
	limits = normalizeWorkspaceLimits(limits)

	var hardLimit int64
	switch metric {
	case "api_requests":
		hardLimit = limits.APIRequestsHardLimit
	case "realtime_events":
		hardLimit = limits.RealtimeEventsHardLimit
	case "function_invocations":
		hardLimit = limits.FunctionInvocationsHard
	default:
		return nil
	}
	if hardLimit <= 0 {
		return nil
	}

	windowSeconds := limits.RateLimitWindowSeconds
	windowStart := time.Now().UTC().Add(-time.Duration(windowSeconds) * time.Second)
	pathFilter := "%"
	switch metric {
	case "api_requests":
		pathFilter = "/api/%"
	case "realtime_events":
		pathFilter = "/api/realtime%"
	case "function_invocations":
		pathFilter = "/api/functions/%/invoke%"
	}

	var current int64
	var oldest *time.Time
	err = s.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*), MIN(created_at)
		FROM _v_audit_logs
		WHERE workspace_id = $1
		  AND created_at >= $2
		  AND path LIKE $3
	`, workspaceID, windowStart, pathFilter).Scan(&current, &oldest)
	if err != nil {
		return err
	}
	if current+incoming <= hardLimit {
		return nil
	}

	retryAfter := int64(1)
	if oldest != nil && !oldest.IsZero() {
		elapsed := time.Since(oldest.UTC()).Seconds()
		remaining := int64(math.Ceil(float64(windowSeconds) - elapsed))
		if remaining > retryAfter {
			retryAfter = remaining
		}
	}
	if retryAfter < 1 {
		retryAfter = 1
	}

	return &WorkspaceRateLimitExceededError{
		Metric:        metric,
		Current:       current,
		Incoming:      incoming,
		Limit:         hardLimit,
		WindowSeconds: windowSeconds,
		RetryAfter:    retryAfter,
	}
}

func (s *WorkspaceService) countWorkspaceTableRows(ctx context.Context, tableName string) (int64, error) {
	if !data.IsValidIdentifier(tableName) {
		return 0, fmt.Errorf("invalid workspace collection name: %s", tableName)
	}

	hasDeletedAt, err := s.tableHasColumn(ctx, tableName, "deleted_at")
	if err != nil {
		return 0, err
	}

	query := fmt.Sprintf("SELECT COUNT(*) FROM %s", data.QuoteIdentifier(tableName))
	if hasDeletedAt {
		query += " WHERE deleted_at IS NULL"
	}

	var count int64
	if err := s.db.Pool.QueryRow(ctx, query).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *WorkspaceService) tableHasColumn(ctx context.Context, tableName, columnName string) (bool, error) {
	var exists bool
	err := s.db.Pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public'
			  AND table_name = $1
			  AND column_name = $2
		)
	`, tableName, columnName).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}
