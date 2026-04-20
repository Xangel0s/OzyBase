package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/logger"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/labstack/echo/v4"
)

type MCPTool struct {
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	RequiresAuth bool           `json:"requires_auth"`
	InputSchema  map[string]any `json:"input_schema,omitempty"`
}

type MCPInvokeRequest struct {
	Tool      string         `json:"tool"`
	Arguments map[string]any `json:"arguments"`
}

type MCPRPCRequest struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id,omitempty"`
	Method  string         `json:"method"`
	Params  map[string]any `json:"params,omitempty"`
}

type MCPRPCResponse struct {
	JSONRPC string       `json:"jsonrpc"`
	ID      any          `json:"id,omitempty"`
	Result  any          `json:"result,omitempty"`
	Error   *MCPRPCError `json:"error,omitempty"`
}

type MCPRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpApprovalRecord struct {
	ID               string         `json:"id"`
	TokenID          string         `json:"token_id,omitempty"`
	TokenSecurity    string         `json:"token_security_level"`
	WorkspaceID      string         `json:"workspace_id,omitempty"`
	ActorSubject     string         `json:"actor_subject,omitempty"`
	Tool             string         `json:"tool"`
	Arguments        map[string]any `json:"arguments"`
	Status           string         `json:"status"`
	Reason           string         `json:"reason"`
	ResolvedNote     string         `json:"resolved_note,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	ApprovedBy       string         `json:"approved_by,omitempty"`
	ApprovedAt       *time.Time     `json:"approved_at,omitempty"`
	RejectedBy       string         `json:"rejected_by,omitempty"`
	RejectedAt       *time.Time     `json:"rejected_at,omitempty"`
	ComputedToolRisk string         `json:"tool_risk"`
}

type mcpApprovalActionRequest struct {
	RequestID string `json:"request_id"`
	Action    string `json:"action"`
	Note      string `json:"note"`
}

type mcpActiveSession struct {
	TokenID         string    `json:"token_id"`
	Name            string    `json:"name"`
	Icon            string    `json:"icon"`
	Activity        string    `json:"activity"`
	IsApproved      bool      `json:"is_approved"`
	SecurityLevel   string    `json:"security_level"`
	AutonomyLevel   string    `json:"autonomy_level"`
	Status          string    `json:"status"`
	LastActivityAt  time.Time `json:"last_activity_at"`
	PendingCount    int       `json:"pending_count"`
	RecentTools     []string  `json:"recent_tools"`
	AvailableSkills []string  `json:"available_skills"`
	AvailableTools  []string  `json:"available_tools"`
}

type mcpStreamEvent struct {
	EventType             string           `json:"event_type"`
	Event                 string           `json:"event"`
	AgentTokenID          string           `json:"agent_token_id,omitempty"`
	AgentName             string           `json:"agent_name,omitempty"`
	UserAgent             string           `json:"user_agent,omitempty"`
	Tool                  string           `json:"tool,omitempty"`
	Result                string           `json:"result,omitempty"`
	StatusMsg             string           `json:"status_msg,omitempty"`
	ActivityDesc          string           `json:"activity_desc,omitempty"`
	SkillID               string           `json:"skill_id,omitempty"`
	SecurityLevel         string           `json:"security_level,omitempty"`
	ToolRisk              string           `json:"tool_risk,omitempty"`
	ActivityKind          string           `json:"activity_kind,omitempty"`
	PipelineFX            string           `json:"pipeline_fx,omitempty"`
	TargetResource        string           `json:"target_resource,omitempty"`
	OperationDetail       string           `json:"operation_detail,omitempty"`
	SkillName             string           `json:"skill_name,omitempty"`
	Icon                  string           `json:"icon,omitempty"`
	Enabled               *bool            `json:"enabled,omitempty"`
	MinLevel              string           `json:"min_level,omitempty"`
	EngramStatus          string           `json:"engram_status,omitempty"`
	EngramTotal           int64            `json:"engram_total_events,omitempty"`
	EngramWindow          int              `json:"engram_window_hours,omitempty"`
	EngramResource        string           `json:"engram_resource_filter,omitempty"`
	EngramRecent          []map[string]any `json:"engram_recent_events,omitempty"`
	EngramEntropy         float64          `json:"engram_entropy_score,omitempty"`
	EngramMood            string           `json:"engram_entropy_state,omitempty"`
	SemanticHealth        string           `json:"semantic_health,omitempty"`
	SemanticPhysical      int64            `json:"semantic_physical_tables,omitempty"`
	SemanticSnapshot      int64            `json:"semantic_snapshot_tables,omitempty"`
	SemanticMissing       []string         `json:"semantic_missing_tables,omitempty"`
	SemanticPhysicalNames []string         `json:"semantic_physical_table_names,omitempty"`
	SemanticSnapshotNames []string         `json:"semantic_snapshot_table_names,omitempty"`
	SemanticAlert         bool             `json:"semantic_recent_security_alert,omitempty"`
	LatencyMS             int64            `json:"latency_ms,omitempty"`
	AlertType             string           `json:"alert_type,omitempty"`
	Critical              bool             `json:"critical,omitempty"`
	Timestamp             time.Time        `json:"timestamp"`
}

type engramEntropyStats struct {
	Score               float64
	State               string
	Color               string
	MutationDensity     float64
	StructuralFragility float64
	AgentDissonance     float64
	ContextBudgetRatio  float64
	ContextBudgetTokens int
}

type mcpStreamSessionClaims struct {
	Scope  string `json:"scope"`
	UserID string `json:"uid,omitempty"`
	Role   string `json:"role,omitempty"`
	jwt.RegisteredClaims
}

type mcpStreamBroker struct {
	mu          sync.RWMutex
	subscribers map[chan mcpStreamEvent]struct{}
}

func newMCPStreamBroker() *mcpStreamBroker {
	return &mcpStreamBroker{subscribers: map[chan mcpStreamEvent]struct{}{}}
}

func (b *mcpStreamBroker) Subscribe(buffer int) chan mcpStreamEvent {
	if buffer <= 0 {
		buffer = 32
	}
	ch := make(chan mcpStreamEvent, buffer)
	b.mu.Lock()
	b.subscribers[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *mcpStreamBroker) Unsubscribe(ch chan mcpStreamEvent) {
	b.mu.Lock()
	if _, ok := b.subscribers[ch]; ok {
		delete(b.subscribers, ch)
		close(ch)
	}
	b.mu.Unlock()
}

func (b *mcpStreamBroker) Publish(event mcpStreamEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

var globalMCPStreamBroker = newMCPStreamBroker()

var (
	mcpLearnedSkillsMu     sync.Mutex
	mcpLearnedSkills       = map[string]map[string]struct{}{}
	mcpLiveSessionsMu      sync.Mutex
	mcpLiveSessions        = map[string]mcpActiveSession{}
	mcpAgentOverrides      = map[string]mcpAgentOverride{}
	mcpDestructionMu       sync.Mutex
	mcpDestructionMap      = map[string]mcpDestructionChallenge{}
	mcpSecurityAlertMu     sync.Mutex
	mcpLastSecurityAlertAt time.Time
)

type mcpAgentOverride struct {
	Name          string
	SecurityLevel string
	AutonomyLevel string
}

type mcpDestructionChallenge struct {
	Token     string
	AgentID   string
	Tool      string
	Target    string
	ExpiresAt time.Time
	CreatedAt time.Time
}

func markMCPSecurityAlert(at time.Time) {
	if at.IsZero() {
		at = time.Now().UTC()
	}
	mcpSecurityAlertMu.Lock()
	mcpLastSecurityAlertAt = at
	mcpSecurityAlertMu.Unlock()
}

func hasRecentMCPSecurityAlert(window time.Duration, now time.Time) (bool, time.Time) {
	if window <= 0 {
		window = 30 * time.Second
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	mcpSecurityAlertMu.Lock()
	last := mcpLastSecurityAlertAt
	mcpSecurityAlertMu.Unlock()
	if last.IsZero() {
		return false, time.Time{}
	}
	return now.Sub(last) <= window, last
}

func (h *Handler) registerMCPLiveSession(_ context.Context, tokenID, level, tool, status, name, userAgent string, at time.Time) {
	tokenID = strings.TrimSpace(tokenID)
	tool = strings.TrimSpace(tool)
	if tokenID == "" {
		return
	}
	baseTokenID := canonicalMCPTokenID(tokenID)
	if baseTokenID == "" {
		baseTokenID = tokenID
	}
	sessionKey := buildMCPLiveSessionKey(baseTokenID, name, userAgent)
	if sessionKey == "" {
		sessionKey = baseTokenID
	}

	// Infer Icon from User-Agent or Name
	icon := "mcp"
	uaLower := strings.ToLower(userAgent)
	nameLower := strings.ToLower(name)
	combined := uaLower + " " + nameLower
	if strings.Contains(combined, "cursor") {
		icon = "cursor"
	} else if strings.Contains(combined, "vscode") || strings.Contains(combined, "visual studio code") {
		icon = "vscode"
	} else if strings.Contains(combined, "antigravity") {
		icon = "antigravity"
	} else if strings.Contains(combined, "python") {
		icon = "python"
	} else if strings.Contains(combined, "claude") {
		icon = "claude"
	}

	mcpLiveSessionsMu.Lock()
	current, ok := mcpLiveSessions[sessionKey]
	if !ok {
		current = mcpActiveSession{TokenID: baseTokenID, Status: status, Name: name, IsApproved: false}
	}
	current.TokenID = baseTokenID
	current.Icon = icon
	if tool != "" {
		current.Activity = fmt.Sprintf("Using %s", tool)
	}

	override := mcpAgentOverrides[baseTokenID]
	if override.SecurityLevel != "" {
		current.SecurityLevel = normalizeMCPSecurityLevel(override.SecurityLevel)
	} else {
		current.SecurityLevel = normalizeMCPSecurityLevel(level)
	}
	if override.AutonomyLevel != "" {
		current.AutonomyLevel = normalizeEngramAutonomyLevel(override.AutonomyLevel)
	}
	if strings.TrimSpace(current.AutonomyLevel) == "" {
		current.AutonomyLevel = engramAutonomyLevelL1
	}
	current.LastActivityAt = at
	if status != "" {
		current.Status = status
	}
	if override.Name != "" {
		current.Name = override.Name
	} else if name != "" {
		current.Name = name
	}

	if tool != "" {
		nextTools := []string{tool}
		for _, existing := range current.RecentTools {
			if len(nextTools) >= 6 {
				break
			}
			if strings.EqualFold(existing, tool) {
				continue
			}
			nextTools = append(nextTools, existing)
		}
		current.RecentTools = nextTools
	}

	mcpLiveSessions[sessionKey] = current
	recentToolsJSON, _ := json.Marshal(current.RecentTools)
	mcpLiveSessionsMu.Unlock()

	if h.DB != nil && h.DB.Pool != nil {
		go func() {
			_, _ = h.DB.Pool.Exec(context.Background(), `
				INSERT INTO "_v_active_mcp_sessions" (agent_id, name, icon, activity, security_level, autonomy_level, status, recent_tools, last_seen, is_approved)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
				ON CONFLICT (agent_id) DO UPDATE SET 
					last_seen = EXCLUDED.last_seen, 
					status = EXCLUDED.status, 
					activity = EXCLUDED.activity,
					icon = COALESCE(EXCLUDED.icon, "_v_active_mcp_sessions".icon),
					recent_tools = EXCLUDED.recent_tools,
					name = CASE
						WHEN COALESCE(NULLIF(BTRIM("_v_active_mcp_sessions".name), ''), 'MCP Agent') = 'MCP Agent'
							THEN EXCLUDED.name
						ELSE "_v_active_mcp_sessions".name
					END,
					security_level = CASE
						WHEN LOWER(COALESCE(NULLIF(BTRIM("_v_active_mcp_sessions".security_level), ''), 'restringido')) = 'restringido'
							THEN EXCLUDED.security_level
						ELSE "_v_active_mcp_sessions".security_level
					END,
					autonomy_level = CASE
						WHEN UPPER(COALESCE(NULLIF(BTRIM("_v_active_mcp_sessions".autonomy_level), ''), 'L1')) = 'L1'
							THEN EXCLUDED.autonomy_level
						ELSE "_v_active_mcp_sessions".autonomy_level
					END
			`, baseTokenID, current.Name, current.Icon, current.Activity, current.SecurityLevel, current.AutonomyLevel, current.Status, recentToolsJSON, at)
		}()
	}
}

func buildMCPLiveSessionKey(tokenID, agentName, userAgent string) string {
	base := strings.TrimSpace(tokenID)
	if base == "" {
		return ""
	}
	name := strings.TrimSpace(agentName)
	if name == "" || strings.EqualFold(name, "MCP Agent") {
		ua := strings.TrimSpace(userAgent)
		if ua == "" {
			return base
		}
		return base + "@" + shortMCPHash(strings.ToLower(ua))
	}
	return base + "@" + normalizeMCPAgentToken(name)
}

func canonicalMCPTokenID(tokenID string) string {
	normalized := strings.ToLower(strings.TrimSpace(tokenID))
	if normalized == "" {
		return ""
	}
	if idx := strings.Index(normalized, "@"); idx > 0 {
		return normalized[:idx]
	}
	return normalized
}

func (h *Handler) listRecentMCPLiveSessions(ctx context.Context, maxAge time.Duration) []mcpActiveSession {
	cutoff := time.Now().UTC().Add(-maxAge)
	var dbSessions []mcpActiveSession

	if h.DB != nil && h.DB.Pool != nil {
		rows, err := h.DB.Pool.Query(ctx, `
			SELECT agent_id, name, icon, activity, is_approved, security_level, autonomy_level, status, recent_tools, pending_count, last_seen 
			FROM "_v_active_mcp_sessions" 
			WHERE last_seen >= $1
			ORDER BY last_seen DESC
		`, cutoff)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var s mcpActiveSession
				var rt []byte
				if err := rows.Scan(&s.TokenID, &s.Name, &s.Icon, &s.Activity, &s.IsApproved, &s.SecurityLevel, &s.AutonomyLevel, &s.Status, &rt, &s.PendingCount, &s.LastActivityAt); err == nil {
					s.AutonomyLevel = normalizeEngramAutonomyLevel(s.AutonomyLevel)
					if s.AutonomyLevel == "" {
						s.AutonomyLevel = engramAutonomyLevelL1
					}
					_ = json.Unmarshal(rt, &s.RecentTools)
					dbSessions = append(dbSessions, s)
				}
			}
		}
	}

	mcpLiveSessionsMu.Lock()
	defer mcpLiveSessionsMu.Unlock()

	merged := make(map[string]mcpActiveSession)
	for _, s := range dbSessions {
		merged[s.TokenID] = s
	}

	for tokenID, session := range mcpLiveSessions {
		if session.LastActivityAt.Before(cutoff) {
			delete(mcpLiveSessions, tokenID)
			continue
		}
		if dbS, ok := merged[tokenID]; !ok || session.LastActivityAt.After(dbS.LastActivityAt) {
			merged[tokenID] = session
		}
	}

	out := make([]mcpActiveSession, 0, len(merged))
	for _, session := range merged {
		copySession := session
		copySession.RecentTools = append([]string{}, session.RecentTools...)
		out = append(out, copySession)
	}

	return out
}

func isMissingMCPSchemaError(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "42P01", "42704", "42703":
			return true
		}
	}
	return false
}

func (h *Handler) ensureMCPApprovalsSchema(ctx context.Context) error {
	_, err := h.DB.Pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_type
				WHERE typname = 'mcp_security_level'
			) THEN
				CREATE TYPE mcp_security_level AS ENUM ('libre', 'medio', 'restringido');
			END IF;
		END $$;

		ALTER TABLE IF EXISTS "_v_api_keys"
			ADD COLUMN IF NOT EXISTS security_level mcp_security_level NOT NULL DEFAULT 'libre';

		CREATE TABLE IF NOT EXISTS "_v_mcp_approvals" (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			token_id UUID,
			token_security_level mcp_security_level NOT NULL,
			workspace_id UUID,
			actor_subject TEXT,
			tool TEXT NOT NULL,
			arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
			status TEXT NOT NULL DEFAULT 'pending',
			reason TEXT NOT NULL DEFAULT '',
			approved_by UUID,
			approved_at TIMESTAMPTZ,
			rejected_by UUID,
			rejected_at TIMESTAMPTZ,
			resolved_note TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CONSTRAINT mcp_approvals_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
		);

		CREATE INDEX IF NOT EXISTS idx_mcp_approvals_status_created_at
			ON "_v_mcp_approvals" (status, created_at DESC);

		CREATE INDEX IF NOT EXISTS idx_mcp_approvals_token_id
			ON "_v_mcp_approvals" (token_id);

		CREATE INDEX IF NOT EXISTS idx_mcp_approvals_workspace_id
			ON "_v_mcp_approvals" (workspace_id);

		CREATE TABLE IF NOT EXISTS "_v_active_mcp_sessions" (
			agent_id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT 'MCP Agent',
			icon TEXT,
			activity TEXT,
			is_approved BOOLEAN NOT NULL DEFAULT false,
			security_level TEXT NOT NULL DEFAULT 'restringido',
			autonomy_level TEXT NOT NULL DEFAULT 'L1' CHECK (autonomy_level IN ('L1', 'L2', 'L3')),
			status TEXT NOT NULL DEFAULT 'idle',
			recent_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
			pending_count INTEGER NOT NULL DEFAULT 0,
			last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		ALTER TABLE IF EXISTS "_v_active_mcp_sessions"
			ADD COLUMN IF NOT EXISTS icon TEXT,
			ADD COLUMN IF NOT EXISTS activity TEXT,
			ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT false;

		ALTER TABLE IF EXISTS "_v_active_mcp_sessions"
			ADD COLUMN IF NOT EXISTS autonomy_level TEXT NOT NULL DEFAULT 'L1';

		ALTER TABLE IF EXISTS "_v_active_mcp_sessions"
			DROP CONSTRAINT IF EXISTS active_mcp_sessions_autonomy_level_check;

		ALTER TABLE IF EXISTS "_v_active_mcp_sessions"
			ADD CONSTRAINT active_mcp_sessions_autonomy_level_check
			CHECK (autonomy_level IN ('L1', 'L2', 'L3'));

		CREATE INDEX IF NOT EXISTS idx_active_mcp_sessions_last_seen
			ON "_v_active_mcp_sessions" (last_seen DESC);

		CREATE TABLE IF NOT EXISTS _v_project_engram (
			id BIGSERIAL PRIMARY KEY,
			agent_token_id TEXT,
			agent_name TEXT NOT NULL DEFAULT 'MCP Agent',
			tool TEXT NOT NULL,
			operation_detail TEXT,
			target_resource TEXT,
			activity_kind TEXT,
			pipeline_fx TEXT,
			security_level TEXT,
			tool_risk TEXT,
			result TEXT,
			status_msg TEXT,
			latency_ms BIGINT,
			tool_arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS idx_project_engram_created_at
			ON _v_project_engram (created_at DESC);
		CREATE INDEX IF NOT EXISTS idx_project_engram_target_resource
			ON _v_project_engram (target_resource);
		CREATE INDEX IF NOT EXISTS idx_project_engram_tool
			ON _v_project_engram (tool);
		CREATE INDEX IF NOT EXISTS idx_project_engram_pipeline_fx
			ON _v_project_engram (pipeline_fx);

		ALTER TABLE IF EXISTS _v_project_engram
			ADD COLUMN IF NOT EXISTS summary_md TEXT,
			ADD COLUMN IF NOT EXISTS causal_ref UUID,
			ADD COLUMN IF NOT EXISTS is_compacted BOOLEAN NOT NULL DEFAULT false,
			ADD COLUMN IF NOT EXISTS compacted_at TIMESTAMPTZ,
			ADD COLUMN IF NOT EXISTS compaction_batch_id TEXT;

		CREATE INDEX IF NOT EXISTS idx_project_engram_compacted_created_at
			ON _v_project_engram (is_compacted, created_at DESC);
	`)
	return err
}

func (h *Handler) mcpPendingFallbackPayload(ctx context.Context) map[string]any {
	recentSessions := h.listRecentMCPLiveSessions(ctx, 30*time.Minute)
	for i := range recentSessions {
		recentSessions[i].PendingCount = 0
		recentSessions[i].AvailableSkills = h.mcpSkillsForLevel(ctx, recentSessions[i].SecurityLevel)
		recentSessions[i].AvailableTools = h.mcpAvailableToolsForLevel(ctx, recentSessions[i].SecurityLevel)
	}
	liveSessions := filterMCPActiveSessionsByWindow(recentSessions, mcpLivePresenceWindow)
	bridgeStatus := "degraded"
	if len(liveSessions) > 0 {
		bridgeStatus = "healthy"
	}

	return map[string]any{
		"items":                []mcpApprovalRecord{},
		"approvals":            []mcpApprovalRecord{},
		"count":                0,
		"active_sessions":      recentSessions,
		"active_sessions_live": liveSessions,
		"active_count":         len(recentSessions),
		"active_count_live":    len(liveSessions),
		"published_tools":      len(buildMCPTools()),
		"bridge_transport":     "jsonrpc-http",
		"bridge_status":        bridgeStatus,
	}
}

func filterMCPActiveSessionsByWindow(sessions []mcpActiveSession, maxAge time.Duration) []mcpActiveSession {
	if len(sessions) == 0 {
		return []mcpActiveSession{}
	}
	if maxAge <= 0 {
		maxAge = mcpLivePresenceWindow
	}
	cutoff := time.Now().UTC().Add(-maxAge)
	live := make([]mcpActiveSession, 0, len(sessions))
	for _, session := range sessions {
		if session.LastActivityAt.IsZero() || session.LastActivityAt.Before(cutoff) {
			continue
		}
		live = append(live, session)
	}
	return live
}

const (
	mcpSecurityLevelLibre       = "libre"
	mcpSecurityLevelMedio       = "medio"
	mcpSecurityLevelRestringido = "restringido"

	engramAutonomyLevelL1 = "L1"
	engramAutonomyLevelL2 = "L2"
	engramAutonomyLevelL3 = "L3"

	engramLLMAPIKeySecretKey = "ozy.engram.llm_api_key"

	mcpToolRiskRead      = "read"
	mcpToolRiskSafeWrite = "safe_write"
	mcpToolRiskDangerous = "dangerous"

	mcpActivityKindRead   = "read"
	mcpActivityKindWrite  = "write"
	mcpActivityKindSystem = "system"
	mcpActivityKindAuth   = "auth"

	mcpPipelineFXPulse  = "pulse"
	mcpPipelineFXFlow   = "flow"
	mcpPipelineFXWarp   = "warp"
	mcpPipelineFXShield = "shield"

	engramAutoCompactionThreshold = 50
	engramAutoCompactionBatchMax  = 500

	mcpGuardrailActionExecute = "execute"
	mcpGuardrailActionPending = "pending_approval"
	mcpGuardrailActionBlocked = "blocked"
)

const mcpLivePresenceWindow = 90 * time.Second

type engramConfigUpdateRequest struct {
	LLMAPIKey string `json:"llm_api_key"`
}

type engramAutonomyConfigResponse struct {
	Level       string `json:"autonomy_level"`
	LastUpdated string `json:"last_updated"`
	UpdatedBy   string `json:"updated_by"`
}

type engramAutonomyConfigUpdateRequest struct {
	Level           string `json:"autonomy_level"`
	AcknowledgeRisk bool   `json:"acknowledge_risk"`
}

type engramCompactionRequest struct {
	ForceLLM bool `json:"force_llm"`
}

type engramDiagnosticCheck struct {
	Name      string `json:"name"`
	OK        bool   `json:"ok"`
	Message   string `json:"message"`
	LatencyMS int64  `json:"latency_ms,omitempty"`
}

type engramDiagnosticResponse struct {
	Status       string                  `json:"status"`
	Synchronized bool                    `json:"synchronized"`
	Summary      string                  `json:"summary"`
	Checks       []engramDiagnosticCheck `json:"checks"`
	Awareness    map[string]any          `json:"awareness,omitempty"`
}

type engramArchitectRequest struct {
	Prompt string `json:"prompt"`
}

type engramArchitectResponse struct {
	Status          string   `json:"status"`
	Response        string   `json:"response"`
	PhysicalTables  int      `json:"physical_tables"`
	MemoryEvents    int64    `json:"memory_events"`
	EntropyState    string   `json:"entropy_state"`
	ContextDebt     bool     `json:"context_debt"`
	MissingEntities []string `json:"missing_entities,omitempty"`
	ResponseMode    string   `json:"response_mode"`
	LLMProvider     string   `json:"llm_provider,omitempty"`
	LLMModel        string   `json:"llm_model,omitempty"`
	FallbackReason  string   `json:"fallback_reason,omitempty"`
}

type architectDomainProfile struct {
	Name       string
	Narrative  string
	Keywords   []string
	CoreLabels []string
}

func isCasualGreetingPrompt(prompt string) bool {
	normalized := strings.ToLower(strings.TrimSpace(prompt))
	if normalized == "" {
		return false
	}

	greetings := []string{
		"hola", "hi", "hello", "buenas", "buenos dias", "buen día", "buen dia",
		"buenas tardes", "buenas noches", "que tal", "qué tal", "saludos",
	}
	for _, g := range greetings {
		if normalized == g {
			return true
		}
	}

	short := strings.Fields(normalized)
	if len(short) <= 3 {
		for _, g := range greetings {
			if strings.Contains(normalized, g) {
				return true
			}
		}
	}
	return false
}

func isTrivialPrompt(prompt string) bool {
	normalized := strings.TrimSpace(strings.ToLower(prompt))
	if normalized == "" {
		return false
	}
	if len([]rune(normalized)) <= 3 {
		return true
	}
	parts := strings.Fields(normalized)
	if len(parts) == 1 && len([]rune(parts[0])) <= 8 {
		return true
	}
	return false
}

func isDeepInfrastructureAuditPrompt(prompt string) bool {
	normalized := strings.ToLower(strings.TrimSpace(prompt))
	if normalized == "" {
		return false
	}
	keywords := []string{
		"deep audit",
		"auditoria de infraestructura",
		"auditoría de infraestructura",
		"infraestructura completa",
		"tablas internas",
		"_v_",
		"system tables",
		"internal tables",
	}
	for _, k := range keywords {
		if strings.Contains(normalized, k) {
			return true
		}
	}
	return false
}

func inferArchitectDomainProfile(tables []string) architectDomainProfile {
	set := map[string]struct{}{}
	for _, t := range tables {
		normalized := strings.ToLower(strings.TrimSpace(t))
		if normalized != "" {
			set[normalized] = struct{}{}
		}
	}
	hasAny := func(candidates ...string) bool {
		for _, c := range candidates {
			if _, ok := set[c]; ok {
				return true
			}
		}
		return false
	}

	switch {
	case hasAny("pc", "roblox", "minecraft", "conexiones"):
		return architectDomainProfile{
			Name:      "Gaming Infrastructure",
			Narrative: "Este sistema funciona como un orquestador de infraestructura gaming: administra estaciones (`pc`), conectividad (`conexiones`) y sesiones de aplicaciones de juego sobre recursos controlados.",
			Keywords:  []string{"latencia", "estaciones", "concurrencia", "sesiones"},
			CoreLabels: []string{
				"Core (estaciones)",
				"Red (conectividad)",
				"App Layer (sesiones de juego)",
			},
		}
	case hasAny("usuarios", "roles", "auth", "_v_users"):
		return architectDomainProfile{
			Name:      "Identity & Access",
			Narrative: "Este sistema prioriza identidad y control de acceso: administra usuarios, permisos y trazabilidad de sesiones bajo un modelo multi-tenant.",
			Keywords:  []string{"acceso", "seguridad", "multi-tenant", "auditoria"},
			CoreLabels: []string{
				"Core (identidad)",
				"Policy (autorización)",
				"Audit (trazabilidad)",
			},
		}
	case hasAny("inventario", "stock", "pedidos", "ordenes"):
		return architectDomainProfile{
			Name:      "Commerce / ERP",
			Narrative: "Este sistema se comporta como capa operativa de comercio/ERP: controla inventario, flujo de pedidos y consistencia de operaciones logísticas.",
			Keywords:  []string{"sku", "rotacion", "logistica", "flujo de caja"},
			CoreLabels: []string{
				"Core (catálogo/stock)",
				"Flow (pedidos)",
				"Ops (logística)",
			},
		}
	default:
		return architectDomainProfile{
			Name:      "General Data Platform",
			Narrative: "Este sistema opera como una plataforma de datos y automatización con foco en consistencia de esquema, seguridad y observabilidad operacional.",
			Keywords:  []string{"consistencia", "gobernanza", "observabilidad", "automatización"},
			CoreLabels: []string{
				"Core (datos)",
				"Control (seguridad)",
				"Ops (observabilidad)",
			},
		}
	}
}

func isNarrativeIntentPrompt(prompt string) bool {
	normalized := strings.ToLower(strings.TrimSpace(prompt))
	if normalized == "" {
		return false
	}
	patterns := []string{
		"de que va",
		"de qué va",
		"que hace el sistema",
		"qué hace el sistema",
		"explicame el sistema",
		"explícame el sistema",
		"para que sirve",
		"para qué sirve",
		"que es este sistema",
		"qué es este sistema",
	}
	for _, pattern := range patterns {
		if strings.Contains(normalized, pattern) {
			return true
		}
	}
	return false
}

func isAnalyticalIntentPrompt(prompt string) bool {
	normalized := strings.ToLower(strings.TrimSpace(prompt))
	if normalized == "" {
		return false
	}
	patterns := []string{
		"analiza",
		"analizar",
		"patrones",
		"errores",
		"mitigacion",
		"mitigación",
		"prioridad",
		"diagnostico",
		"diagnóstico",
		"incidencia",
		"plan tecnico",
		"plan técnico",
		"root cause",
	}
	for _, pattern := range patterns {
		if strings.Contains(normalized, pattern) {
			return true
		}
	}
	return false
}

func wantsExplicitTechnicalAudit(prompt string) bool {
	normalized := strings.ToLower(strings.TrimSpace(prompt))
	if normalized == "" {
		return false
	}
	patterns := []string{
		"ver auditoria",
		"ver auditoría",
		"detalles tecnicos",
		"detalles técnicos",
		"cadena causal",
		"foreign key",
		"fk",
		"estado semantico",
		"estado semántico",
		"muestra el grafico",
		"muestra el gráfico",
		"deep audit",
	}
	for _, pattern := range patterns {
		if strings.Contains(normalized, pattern) {
			return true
		}
	}
	return false
}


func shouldMentionInconsistencyHook(prompt string, contextDebt bool, explicitAudit bool, deepAudit bool) bool {
	if !contextDebt {
		return false
	}
	if explicitAudit || deepAudit {
		return true
	}
	normalized := strings.ToLower(strings.TrimSpace(prompt))
	if normalized == "" {
		return false
	}
	keywords := []string{
		"inconsisten", "context debt", "deuda", "drift", "snapshot",
		"desaline", "error", "problema", "riesgo", "falla", "fallo",
		"auditor", "fk", "causal",
	}
	for _, k := range keywords {
		if strings.Contains(normalized, k) {
			return true
		}
	}
	return false
}

func inferEngramLLMProvider(apiKey string) string {
	trimmed := strings.TrimSpace(apiKey)
	if trimmed == "" {
		return "none"
	}
	lower := strings.ToLower(trimmed)
	switch {
	case strings.HasPrefix(trimmed, "AIza"):
		return "gemini"
	case strings.HasPrefix(lower, "sk-or-"), strings.Contains(lower, "openrouter"):
		return "openrouter"
	case strings.HasPrefix(lower, "sk-"), strings.HasPrefix(lower, "sess-"):
		return "openai"
	default:
		// Keep backward-compatible default.
		return "openai"
	}
}

func normalizeEngramAutonomyLevel(raw string) string {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case engramAutonomyLevelL1:
		return engramAutonomyLevelL1
	case engramAutonomyLevelL3:
		return engramAutonomyLevelL3
	default:
		return engramAutonomyLevelL2
	}
}



func autonomyTitleForLevel(level string) string {
	switch normalizeEngramAutonomyLevel(level) {
	case engramAutonomyLevelL1:
		return "Observador"
	case engramAutonomyLevelL3:
		return "Soberano"
	default:
		return "Copiloto"
	}
}

func autonomyDescriptionForLevel(level string) string {
	switch normalizeEngramAutonomyLevel(level) {
	case engramAutonomyLevelL1:
		return "Solo diagnóstico y lectura. Mutaciones bloqueadas."
	case engramAutonomyLevelL3:
		return "Autonomía total para ejecutar mutaciones en caliente."
	default:
		return "Modo seguro con autorización humana para escritura."
	}
}

func (h *Handler) ensureEngramAutonomyConfigSchema(ctx context.Context) error {
	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return nil
	}

	if _, err := h.DB.Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS _v_engram_config (
			id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
			autonomy_level TEXT NOT NULL DEFAULT 'L2' CHECK (autonomy_level IN ('L1', 'L2', 'L3')),
			last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_by TEXT NOT NULL DEFAULT 'system'
		)
	`); err != nil {
		return err
	}

	_, err := h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_engram_config (id, autonomy_level, last_updated, updated_by)
		VALUES (TRUE, 'L2', NOW(), 'system')
		ON CONFLICT (id) DO NOTHING
	`)
	return err
}

func (h *Handler) loadEngramAutonomyConfig(ctx context.Context) (engramAutonomyConfigResponse, error) {
	current := engramAutonomyConfigResponse{
		Level:       engramAutonomyLevelL2,
		LastUpdated: time.Now().UTC().Format(time.RFC3339),
		UpdatedBy:   "system",
	}

	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return current, nil
	}

	if err := h.ensureEngramAutonomyConfigSchema(ctx); err != nil {
		return current, err
	}

	var (
		level string
		at    time.Time
		by    string
	)
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT autonomy_level, last_updated, COALESCE(updated_by, 'system')
		FROM _v_engram_config
		WHERE id = TRUE
		LIMIT 1
	`).Scan(&level, &at, &by)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return current, nil
		}
		return current, err
	}

	current.Level = normalizeEngramAutonomyLevel(level)
	current.LastUpdated = at.UTC().Format(time.RFC3339)
	current.UpdatedBy = strings.TrimSpace(by)
	if current.UpdatedBy == "" {
		current.UpdatedBy = "system"
	}

	return current, nil
}

func (h *Handler) saveEngramAutonomyConfig(ctx context.Context, level, updatedBy string) (engramAutonomyConfigResponse, error) {
	normalized := normalizeEngramAutonomyLevel(level)
	actor := strings.TrimSpace(updatedBy)
	if actor == "" {
		actor = "system"
	}

	if err := h.ensureEngramAutonomyConfigSchema(ctx); err != nil {
		return engramAutonomyConfigResponse{}, err
	}

	var (
		at time.Time
		by string
	)
	err := h.DB.Pool.QueryRow(ctx, `
		INSERT INTO _v_engram_config (id, autonomy_level, last_updated, updated_by)
		VALUES (TRUE, $1, NOW(), $2)
		ON CONFLICT (id)
		DO UPDATE SET autonomy_level = EXCLUDED.autonomy_level, last_updated = NOW(), updated_by = EXCLUDED.updated_by
		RETURNING autonomy_level, last_updated, COALESCE(updated_by, 'system')
	`, normalized, actor).Scan(&level, &at, &by)
	if err != nil {
		return engramAutonomyConfigResponse{}, err
	}

	return engramAutonomyConfigResponse{
		Level:       normalizeEngramAutonomyLevel(level),
		LastUpdated: at.UTC().Format(time.RFC3339),
		UpdatedBy:   strings.TrimSpace(by),
	}, nil
}

func validateEngramLLMAuth(ctx context.Context, apiKey string) (provider string, detail string, latencyMS int64, err error) {
	provider = inferEngramLLMProvider(apiKey)
	started := time.Now()

	requestURL := ""
	buildReq := func() (*http.Request, error) {
		switch provider {
		case "gemini":
			requestURL = "https://generativelanguage.googleapis.com/v1beta/models?key=" + url.QueryEscape(strings.TrimSpace(apiKey))
			req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, http.NoBody)
			if reqErr != nil {
				return nil, reqErr
			}
			req.Header.Set("x-goog-api-key", strings.TrimSpace(apiKey))
			req.Header.Set("Accept", "application/json")
			return req, nil
		case "openrouter":
			requestURL = "https://openrouter.ai/api/v1/models"
			req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, http.NoBody)
			if reqErr != nil {
				return nil, reqErr
			}
			req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
			req.Header.Set("Accept", "application/json")
			req.Header.Set("HTTP-Referer", "https://ozybase.local")
			req.Header.Set("X-Title", "OzyBase Architect")
			return req, nil
		default:
			requestURL = "https://api.openai.com/v1/models"
			req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, http.NoBody)
			if reqErr != nil {
				return nil, reqErr
			}
			req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
			req.Header.Set("Accept", "application/json")
			return req, nil
		}
	}

	req, reqErr := buildReq()
	if reqErr != nil {
		return provider, "no se pudo construir la solicitud de validacion LLM", time.Since(started).Milliseconds(), reqErr
	}

	client := &http.Client{Timeout: 8 * time.Second}
	res, callErr := client.Do(req)
	if callErr != nil {
		return provider, "no se pudo conectar con el proveedor LLM", time.Since(started).Milliseconds(), callErr
	}
	defer res.Body.Close()

	latencyMS = time.Since(started).Milliseconds()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 256))
		detail = fmt.Sprintf("%s respondio %d (%s)", strings.ToUpper(provider), res.StatusCode, strings.TrimSpace(string(body)))
		return provider, detail, latencyMS, fmt.Errorf("provider rejected api key")
	}

	return provider, fmt.Sprintf("%s autenticado correctamente", strings.ToUpper(provider)), latencyMS, nil
}

func validateEngramLLMGenerate(ctx context.Context, apiKey string) (provider string, model string, detail string, latencyMS int64, err error) {
	provider = inferEngramLLMProvider(apiKey)
	started := time.Now()

	type genAttempt struct {
		provider string
		model    string
		endpoint string
		headers  map[string]string
		body     any
	}

	buildAttempts := func() []genAttempt {
		switch provider {
		case "gemini":
			prompt := "Responde exactamente: PONG"
			body := map[string]any{
				"contents": []map[string]any{
					{"parts": []map[string]any{{"text": prompt}}},
				},
			}
			return []genAttempt{
				{
					provider: "gemini",
					model:    "gemini-2.5-flash",
					endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + url.QueryEscape(strings.TrimSpace(apiKey)),
					headers: map[string]string{
						"Content-Type":   "application/json",
						"Accept":         "application/json",
						"x-goog-api-key": strings.TrimSpace(apiKey),
					},
					body: body,
				},
				{
					provider: "gemini",
					model:    "gemini-2.0-flash",
					endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + url.QueryEscape(strings.TrimSpace(apiKey)),
					headers: map[string]string{
						"Content-Type":   "application/json",
						"Accept":         "application/json",
						"x-goog-api-key": strings.TrimSpace(apiKey),
					},
					body: body,
				},
			}
		case "openrouter":
			return []genAttempt{
				{
					provider: "openrouter",
					model:    "openai/gpt-4o-mini",
					endpoint: "https://openrouter.ai/api/v1/chat/completions",
					headers: map[string]string{
						"Content-Type":  "application/json",
						"Accept":        "application/json",
						"Authorization": "Bearer " + strings.TrimSpace(apiKey),
						"HTTP-Referer":  "https://ozybase.local",
						"X-Title":       "OzyBase Architect",
					},
					body: map[string]any{
						"model": "openai/gpt-4o-mini",
						"messages": []map[string]any{
							{"role": "user", "content": "Responde exactamente: PONG"},
						},
						"temperature": 0,
						"max_tokens":  8,
					},
				},
			}
		default:
			provider = "openai"
			return []genAttempt{
				{
					provider: "openai",
					model:    "gpt-4o-mini",
					endpoint: "https://api.openai.com/v1/chat/completions",
					headers: map[string]string{
						"Content-Type":  "application/json",
						"Accept":        "application/json",
						"Authorization": "Bearer " + strings.TrimSpace(apiKey),
					},
					body: map[string]any{
						"model": "gpt-4o-mini",
						"messages": []map[string]any{
							{"role": "user", "content": "Responde exactamente: PONG"},
						},
						"temperature": 0,
						"max_tokens":  8,
					},
				},
			}
		}
	}

	client := &http.Client{Timeout: 10 * time.Second}
	attempts := buildAttempts()
	var lastErr error
	for _, attempt := range attempts {
		model = attempt.model
		payload, _ := json.Marshal(attempt.body)
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, attempt.endpoint, bytes.NewReader(payload))
		if reqErr != nil {
			lastErr = reqErr
			continue
		}
		for k, v := range attempt.headers {
			req.Header.Set(k, v)
		}
		res, callErr := client.Do(req)
		if callErr != nil {
			lastErr = callErr
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(res.Body, 256))
		res.Body.Close()
		latencyMS = time.Since(started).Milliseconds()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			lastErr = fmt.Errorf("llm runtime status %d (%s/%s): %s", res.StatusCode, attempt.provider, attempt.model, strings.TrimSpace(string(body)))
			continue
		}
		detail = fmt.Sprintf("%s runtime ok (%s)", strings.ToUpper(attempt.provider), attempt.model)
		return attempt.provider, attempt.model, detail, latencyMS, nil
	}

	latencyMS = time.Since(started).Milliseconds()
	if lastErr == nil {
		lastErr = errors.New("llm runtime check failed")
	}
	return provider, model, "runtime generation failed", latencyMS, lastErr
}

func maskSensitiveToken(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) <= 8 {
		return strings.Repeat("*", len(trimmed))
	}
	return trimmed[:4] + strings.Repeat("*", len(trimmed)-8) + trimmed[len(trimmed)-4:]
}

func (h *Handler) loadEngramLLMAPIKey(ctx context.Context) (string, error) {
	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return "", nil
	}

	var key string
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT value
		FROM _v_secrets
		WHERE key = $1
	`, engramLLMAPIKeySecretKey).Scan(&key)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}

	return strings.TrimSpace(key), nil
}

func (h *Handler) saveEngramLLMAPIKey(ctx context.Context, apiKey string) error {
	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return nil
	}

	trimmed := strings.TrimSpace(apiKey)
	if trimmed == "" {
		_, err := h.DB.Pool.Exec(ctx, `DELETE FROM _v_secrets WHERE key = $1`, engramLLMAPIKeySecretKey)
		return err
	}

	_, err := h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_secrets (key, value, description)
		VALUES ($1, $2, $3)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description
	`, engramLLMAPIKeySecretKey, trimmed, "Portal de Sincronia: LLM API key")
	return err
}

// GetEngramConfig handles GET /api/project/engram/config
func (h *Handler) GetEngramConfig(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 8*time.Second)
	defer cancel()

	apiKey, err := h.loadEngramLLMAPIKey(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load engram config"})
	}

	status := "DISCONNECTED"
	provider := "none"
	if strings.TrimSpace(apiKey) != "" {
		status = "KERNEL_READY"
		provider = inferEngramLLMProvider(apiKey)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":         "ok",
		"provider":       provider,
		"has_api_key":    strings.TrimSpace(apiKey) != "",
		"api_key_masked": maskSensitiveToken(apiKey),
		"sync_state":     status,
	})
}

// GetEngramAutonomyConfig handles GET /api/project/engram/autonomy
func (h *Handler) GetEngramAutonomyConfig(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 8*time.Second)
	defer cancel()

	current, err := h.loadEngramAutonomyConfig(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load autonomy config"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":         "ok",
		"autonomy_level": current.Level,
		"autonomy_name":  autonomyTitleForLevel(current.Level),
		"description":    autonomyDescriptionForLevel(current.Level),
		"last_updated":   current.LastUpdated,
		"updated_by":     current.UpdatedBy,
	})
}

// SaveEngramAutonomyConfig handles POST /api/project/engram/autonomy
func (h *Handler) SaveEngramAutonomyConfig(c echo.Context) error {
	var req engramAutonomyConfigUpdateRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request payload"})
	}

	normalized := normalizeEngramAutonomyLevel(req.Level)
	if normalized == engramAutonomyLevelL3 && !req.AcknowledgeRisk {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "risk acknowledgement is required for L3"})
	}

	actor := strings.TrimSpace(userIDFromContext(c))
	if actor == "" {
		actor = strings.TrimSpace(roleFromContext(c))
	}
	if actor == "" {
		actor = "admin"
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 8*time.Second)
	defer cancel()

	saved, err := h.saveEngramAutonomyConfig(ctx, normalized, actor)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to save autonomy config"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":         "saved",
		"autonomy_level": saved.Level,
		"autonomy_name":  autonomyTitleForLevel(saved.Level),
		"description":    autonomyDescriptionForLevel(saved.Level),
		"last_updated":   saved.LastUpdated,
		"updated_by":     saved.UpdatedBy,
	})
}

// SaveEngramConfig handles POST /api/project/engram/config
func (h *Handler) SaveEngramConfig(c echo.Context) error {
	var req engramConfigUpdateRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request payload"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 8*time.Second)
	defer cancel()

	if err := h.saveEngramLLMAPIKey(ctx, req.LLMAPIKey); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to save engram config"})
	}

	if strings.TrimSpace(req.LLMAPIKey) != "" {
		go h.maybeRunSemanticCompaction("config_update")
	}

	masked := maskSensitiveToken(req.LLMAPIKey)
	provider := inferEngramLLMProvider(req.LLMAPIKey)
	return c.JSON(http.StatusOK, map[string]any{
		"status":         "saved",
		"provider":       provider,
		"has_api_key":    strings.TrimSpace(req.LLMAPIKey) != "",
		"api_key_masked": masked,
	})
}

// CompactEngramNow handles POST /api/project/engram/compact-now
func (h *Handler) CompactEngramNow(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 60*time.Second)
	defer cancel()

	var req engramCompactionRequest
	_ = c.Bind(&req)
	forceQuery := strings.EqualFold(strings.TrimSpace(c.QueryParam("force_llm")), "true")
	forceLLM := req.ForceLLM || forceQuery

	result, err := h.runSemanticCompaction(ctx, "manual", forceLLM)
	if err != nil {
		recoverable := map[string]bool{
			"missing_api_key":         true,
			"below_threshold":         true,
			"nothing_to_compact":      true,
			"llm_distillation_failed": true,
			"api_key_load_failed":     true,
		}
		if recoverable[result.Reason] {
			return c.JSON(http.StatusOK, map[string]any{
				"status": "ok",
				"result": result,
				"error":  sanitizeLLMError(err),
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]any{
			"status": "error",
			"error":  err.Error(),
			"result": result,
		})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status": "ok",
		"result": result,
	})
}

// TestEngramSync handles POST /api/project/engram/config/test
func (h *Handler) TestEngramSync(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
	defer cancel()

	checks := make([]engramDiagnosticCheck, 0, 4)
	response := engramDiagnosticResponse{
		Status:       "DB_OFFLINE",
		Synchronized: false,
		Summary:      "Diagnostico pendiente.",
		Checks:       checks,
	}

	dbStarted := time.Now()
	if err := h.DB.Pool.QueryRow(ctx, "SELECT 1").Scan(new(int)); err != nil {
		response.Checks = append(response.Checks, engramDiagnosticCheck{Name: "database", OK: false, Message: "No se pudo conectar a PostgreSQL.", LatencyMS: time.Since(dbStarted).Milliseconds()})
		response.Summary = "DB_OFFLINE: PostgreSQL no responde."
		return c.JSON(http.StatusOK, response)
	}
	response.Checks = append(response.Checks, engramDiagnosticCheck{Name: "database", OK: true, Message: "PostgreSQL operativo.", LatencyMS: time.Since(dbStarted).Milliseconds()})

	if err := h.ensureMCPApprovalsSchema(ctx); err != nil {
		response.Status = "ENGRAM_EMPTY"
		response.Checks = append(response.Checks, engramDiagnosticCheck{
			Name:      "engram_store",
			OK:        false,
			Message:   "No se pudo preparar el store de Engram.",
			LatencyMS: 0,
		})
		response.Summary = "ENGRAM_EMPTY: no fue posible inicializar el store de Engram."
		return c.JSON(http.StatusOK, response)
	}

	awarenessStarted := time.Now()
	awarenessResult, _, found, awarenessErr := h.executeMCPTool(ctx, "get_project_awareness", map[string]any{"limit": 8, "window_hours": 24}, "")
	if awarenessErr != nil || !found {
		response.Status = "MCP_DISCONNECTED"
		response.Checks = append(response.Checks, engramDiagnosticCheck{Name: "mcp_awareness", OK: false, Message: "MCP/Engram no responde al tool get_project_awareness.", LatencyMS: time.Since(awarenessStarted).Milliseconds()})
		response.Summary = "MCP_DISCONNECTED: no fue posible obtener awareness del proyecto."
		return c.JSON(http.StatusOK, response)
	}

	awarenessMap, _ := awarenessResult.(map[string]any)
	response.Awareness = awarenessMap
	response.Checks = append(response.Checks, engramDiagnosticCheck{Name: "mcp_awareness", OK: true, Message: "MCP awareness operativo.", LatencyMS: time.Since(awarenessStarted).Milliseconds()})

	totalEvents := int64(0)
	if rawTotal, ok := awarenessMap["total_events"]; ok {
		switch v := rawTotal.(type) {
		case float64:
			totalEvents = int64(v)
		case int64:
			totalEvents = v
		case int:
			totalEvents = int64(v)
		}
	}

	var engramRows int64
	engramCountStarted := time.Now()
	if err := h.DB.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM _v_project_engram`).Scan(&engramRows); err != nil {
		response.Status = "ENGRAM_EMPTY"
		response.Checks = append(response.Checks, engramDiagnosticCheck{Name: "engram_table", OK: false, Message: "No se pudo leer _v_project_engram.", LatencyMS: time.Since(engramCountStarted).Milliseconds()})
		response.Summary = "ENGRAM_EMPTY: el store _v_project_engram no esta disponible."
		return c.JSON(http.StatusOK, response)
	}

	if engramRows <= 0 || totalEvents <= 0 {
		response.Status = "KERNEL_IDLE"
		response.Synchronized = true
		response.Checks = append(response.Checks, engramDiagnosticCheck{Name: "engram_table", OK: true, Message: "Store disponible; esperando primer flujo de datos.", LatencyMS: time.Since(engramCountStarted).Milliseconds()})
		response.Summary = "KERNEL_IDLE: Store disponible, esperando primer flujo de datos."
		return c.JSON(http.StatusOK, response)
	}
	response.Checks = append(response.Checks, engramDiagnosticCheck{Name: "engram_table", OK: true, Message: fmt.Sprintf("_v_project_engram contiene %d filas; awareness reporta %d eventos.", engramRows, totalEvents), LatencyMS: time.Since(engramCountStarted).Milliseconds()})

	apiKey, err := h.loadEngramLLMAPIKey(ctx)
	if err != nil || strings.TrimSpace(apiKey) == "" {
		response.Status = "LLM_AUTH_FAILED"
		response.Checks = append(response.Checks, engramDiagnosticCheck{Name: "llm_auth", OK: false, Message: "No hay API key valida configurada en el Portal de Sincronia."})
		response.Summary = "LLM_AUTH_FAILED: configura OZY_LLM_API_KEY para completar la sincronia."
		return c.JSON(http.StatusOK, response)
	}

	provider, detail, latencyMS, authErr := validateEngramLLMAuth(ctx, apiKey)
	if authErr != nil {
		response.Status = "LLM_AUTH_FAILED"
		response.Checks = append(response.Checks, engramDiagnosticCheck{
			Name:      "llm_auth",
			OK:        false,
			Message:   detail,
			LatencyMS: latencyMS,
		})
		response.Summary = fmt.Sprintf("LLM_AUTH_FAILED: la API key no fue aceptada por %s.", strings.ToUpper(provider))
		return c.JSON(http.StatusOK, response)
	}

	response.Checks = append(response.Checks, engramDiagnosticCheck{
		Name:      "llm_auth",
		OK:        true,
		Message:   detail,
		LatencyMS: latencyMS,
	})

	runtimeProvider, runtimeModel, runtimeDetail, runtimeLatency, runtimeErr := validateEngramLLMGenerate(ctx, apiKey)
	if runtimeErr != nil {
		response.Status = "LLM_RUNTIME_FAILED"
		response.Checks = append(response.Checks, engramDiagnosticCheck{
			Name:      "llm_generate",
			OK:        false,
			Message:   fmt.Sprintf("%s (%s/%s)", sanitizeLLMError(runtimeErr), runtimeProvider, runtimeModel),
			LatencyMS: runtimeLatency,
		})
		response.Summary = fmt.Sprintf("LLM_RUNTIME_FAILED: %s autenticó, pero no pudo generar respuesta en runtime.", strings.ToUpper(runtimeProvider))
		return c.JSON(http.StatusOK, response)
	}
	response.Checks = append(response.Checks, engramDiagnosticCheck{
		Name:      "llm_generate",
		OK:        true,
		Message:   runtimeDetail,
		LatencyMS: runtimeLatency,
	})

	response.Status = "SYNC_COMPLETE"
	response.Synchronized = true
	response.Summary = fmt.Sprintf("SYNC_COMPLETE: Engram y %s listos. Estado SYNCHRONIZED.", strings.ToUpper(provider))

	return c.JSON(http.StatusOK, response)
}

// RespondEngramArchitect handles POST /api/project/engram/respond
// It centralizes the Lead Architect persona and injects real-time grounding metrics.
func (h *Handler) RespondEngramArchitect(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 15*time.Second)
	defer cancel()

	var req engramArchitectRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid architect payload"})
	}
	userPrompt := strings.TrimSpace(req.Prompt)
	if userPrompt == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "prompt is required"})
	}

	_ = h.ensureMCPApprovalsSchema(ctx)

	var physicalTables int
	if err := h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM pg_tables
		WHERE schemaname = 'public'
		  AND tablename NOT LIKE '\_v\_%' ESCAPE '\'
	`).Scan(&physicalTables); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to inspect physical schema"})
	}

	var memoryEvents int64
	if err := h.DB.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM _v_project_engram WHERE COALESCE(is_compacted, false) = false`).Scan(&memoryEvents); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to inspect engram store"})
	}

	var semanticSnapshots int64
	if err := h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT target_resource)
		FROM _v_project_engram
		WHERE tool IN ('schema.semantic_snapshot', 'schema.semantic_autodoc')
		  AND COALESCE(target_resource, '') <> ''
		  AND target_resource <> 'system'
		  AND target_resource NOT LIKE '\_v\_%' ESCAPE '\'
	`).Scan(&semanticSnapshots); err != nil {
		semanticSnapshots = 0
	}

	var entropyState string
	if err := h.DB.Pool.QueryRow(ctx, `
		SELECT COALESCE(to_jsonb(e)->>'entropy_state','')
		FROM _v_project_engram e
		ORDER BY created_at DESC
		LIMIT 1
	`).Scan(&entropyState); err != nil {
		entropyState = ""
	}
	entropyState = strings.TrimSpace(strings.ToLower(entropyState))
	if entropyState == "" {
		entropyState = "flow"
	}

	physicalNames := []string{}
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT tablename
		FROM pg_tables
		WHERE schemaname = 'public'
		  AND tablename NOT LIKE '\_v\_%' ESCAPE '\'
		ORDER BY tablename
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var n string
			if scanErr := rows.Scan(&n); scanErr == nil {
				physicalNames = append(physicalNames, strings.ToLower(strings.TrimSpace(n)))
			}
		}
	}

	snapshotResources := map[string]struct{}{}
	evRows, evErr := h.DB.Pool.Query(ctx, `
		SELECT DISTINCT COALESCE(target_resource,'')
		FROM _v_project_engram
		WHERE tool IN ('schema.semantic_snapshot', 'schema.semantic_autodoc')
		  AND COALESCE(target_resource, '') <> ''
		  AND target_resource <> 'system'
		  AND target_resource NOT LIKE '\_v\_%' ESCAPE '\'
	`)
	if evErr == nil {
		defer evRows.Close()
		for evRows.Next() {
			var resource string
			if scanErr := evRows.Scan(&resource); scanErr != nil {
				continue
			}
			normalized := strings.ToLower(strings.TrimSpace(resource))
			normalized = strings.ReplaceAll(normalized, "public.", "")
			if normalized != "" {
				snapshotResources[normalized] = struct{}{}
			}
		}
	}

	missing := make([]string, 0, len(physicalNames))
	for _, table := range physicalNames {
		if _, ok := snapshotResources[table]; !ok {
			missing = append(missing, table)
		}
	}

	contextDebt := len(missing) > 0 || int64(physicalTables) > semanticSnapshots
	explicitAudit := wantsExplicitTechnicalAudit(userPrompt)
	domainProfile := inferArchitectDomainProfile(physicalNames)
	mentionInconsistencyHook := shouldMentionInconsistencyHook(userPrompt, contextDebt, explicitAudit, isDeepInfrastructureAuditPrompt(userPrompt))
	inconsistencyHook := ""
	if contextDebt && mentionInconsistencyHook {
		targets := missing
		if len(targets) == 0 {
			targets = []string{"esquema y memoria"}
		}
		inconsistencyHook = " ...pero tenemos tablas sin snapshot semántico en " + strings.Join(targets, ", ") + ". Aclaración: las tablas físicas sí existen; falta su contexto/snapshot en Engram."
	}

	var b strings.Builder
	deepAudit := isDeepInfrastructureAuditPrompt(userPrompt)
	var hiddenInternalTables int
	if err := h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM pg_tables
		WHERE schemaname = 'public'
		  AND tablename ~ '^_v_'
	`).Scan(&hiddenInternalTables); err != nil {
		hiddenInternalTables = 0
	}
	relationQuery := `
		SELECT tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
		  ON tc.constraint_name = kcu.constraint_name
		 AND tc.table_schema = kcu.table_schema
		JOIN information_schema.constraint_column_usage ccu
		  ON ccu.constraint_name = tc.constraint_name
		 AND ccu.table_schema = tc.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY'
		  AND tc.table_schema = 'public'
	`
	if !deepAudit {
		relationQuery += `
		  AND tc.table_name !~ '^_v_'
		  AND ccu.table_name !~ '^_v_'
		`
	}
	relationRows, relErr := h.DB.Pool.Query(ctx, relationQuery)
	relations := make([]string, 0, 10)
	if relErr == nil {
		defer relationRows.Close()
		for relationRows.Next() {
			var tableName, columnName, refTable, refColumn string
			if scanErr := relationRows.Scan(&tableName, &columnName, &refTable, &refColumn); scanErr == nil {
				relations = append(relations, fmt.Sprintf("%s.%s -> %s.%s", strings.ToLower(tableName), strings.ToLower(columnName), strings.ToLower(refTable), strings.ToLower(refColumn)))
			}
		}
	}

	recentChanges := make([]string, 0, 5)
	changeRows, changeErr := h.DB.Pool.Query(ctx, `
		SELECT
			COALESCE(operation_detail, tool, 'operación'),
			COALESCE(target_resource, 'system'),
			COALESCE(result, 'unknown')
		FROM _v_project_engram
		WHERE COALESCE(is_compacted, false) = false
		ORDER BY created_at DESC
		LIMIT 5
	`)
	if changeErr == nil {
		defer changeRows.Close()
		for changeRows.Next() {
			var op, target, result string
			if err := changeRows.Scan(&op, &target, &result); err != nil {
				continue
			}
			recentChanges = append(recentChanges, fmt.Sprintf("%s en %s (%s)", strings.TrimSpace(op), strings.TrimSpace(target), strings.TrimSpace(result)))
		}
	}

	if isTrivialPrompt(userPrompt) {
		b.WriteString("Listo, sigo aquí.")
		if inconsistencyHook != "" {
			b.WriteString(inconsistencyHook)
		}
	} else if isCasualGreetingPrompt(userPrompt) {
		b.WriteString("Aquí sigo, Miguel. Dime en qué nos enfocamos ahora.")
		if inconsistencyHook != "" {
			b.WriteString(inconsistencyHook)
		}
	} else if isNarrativeIntentPrompt(userPrompt) {
		b.WriteString("## 🌐 Narrativa del Ecosistema\n")
		b.WriteString("**Dominio inferido:** `")
		b.WriteString(domainProfile.Name)
		b.WriteString("`\n\n")
		b.WriteString(domainProfile.Narrative)
		b.WriteString("\n\n")
		b.WriteString("## 📊 Auditoría de Arquitectura\n")
		b.WriteString("| Componente | Estado | Relación Clave |\n")
		b.WriteString("|---|---|---|\n")
		coreLabel := "Core"
		redLabel := "Red"
		appLabel := "App Layer"
		if len(domainProfile.CoreLabels) >= 3 {
			coreLabel = domainProfile.CoreLabels[0]
			redLabel = domainProfile.CoreLabels[1]
			appLabel = domainProfile.CoreLabels[2]
		}
		b.WriteString("| " + coreLabel + " | Sincronizado | `pk` como eje de integridad |\n")
		if len(relations) > 0 {
			primaryRel := relations[0]
			secondaryRel := strings.Join(relations, ", ")
			b.WriteString("| " + redLabel + " | Estable | `" + primaryRel + "` |\n")
			b.WriteString("| " + appLabel + " | Activa | `" + secondaryRel + "` |\n\n")
		} else {
			b.WriteString("| " + redLabel + " | Sin FK detectada | Revisar snapshots de conectividad |\n")
			b.WriteString("| " + appLabel + " | Parcial | Revisar snapshots de capa de aplicación |\n\n")
		}

		b.WriteString("```text\n")
		if contextDebt {
			b.WriteString(fmt.Sprintf("[WARN] ESTADO SEMÁNTICO: DESALINEADO (%d/%d snapshots)\n", semanticSnapshots, physicalTables))
			if len(missing) > 0 {
				b.WriteString("[WARN] ContextDebt: " + strings.Join(missing, ", ") + "\n")
			}
		} else {
			b.WriteString(fmt.Sprintf("[INFO] ESTADO SEMÁNTICO: ALINEADO (%d/%d snapshots)\n", semanticSnapshots, physicalTables))
		}
		b.WriteString("[INFO] Entropy: " + strings.ToUpper(entropyState) + "\n")
		if len(domainProfile.Keywords) > 0 {
			b.WriteString("[INFO] Lexico de dominio: " + strings.Join(domainProfile.Keywords, ", ") + "\n")
		}
		if deepAudit {
			b.WriteString("[INFO] Filtro de capas: DeepAudit (internas incluidas)\n")
		} else {
			b.WriteString(fmt.Sprintf("[INFO] Filtro de capas: Activo (%d internas ocultas)\n", hiddenInternalTables))
		}
		b.WriteString("```\n")
	} else {
		analyticalIntent := isAnalyticalIntentPrompt(userPrompt)
		shouldAttachAudit := explicitAudit || deepAudit

		if analyticalIntent {
			b.WriteString("## Diagnóstico técnico\n")
			if contextDebt {
				b.WriteString(fmt.Sprintf("- Se detecta **deuda de contexto**: `%d` tablas físicas vs `%d` snapshots semánticos.\n", physicalTables, semanticSnapshots))
				if len(missing) > 0 {
					b.WriteString("- Entidades faltantes de snapshot: `")
					b.WriteString(strings.Join(missing, "`, `"))
					b.WriteString("`.\n")
				}
			} else {
				b.WriteString("- No se detecta deuda de contexto estructural en este momento.\n")
			}
			b.WriteString(fmt.Sprintf("- Entropía operacional actual: `%s`.\n", strings.ToUpper(entropyState)))
			b.WriteString("- Recomendación inmediata: compactar micro-eventos históricos en un `schema.master_snapshot` para reducir ruido analítico.\n\n")
			if shouldAttachAudit {
				b.WriteString("<details>\n<summary>Ver auditoría estructural</summary>\n\n")
			}
		} else {
			b.WriteString("Entendido. ")
			b.WriteString("vamos al punto.")
			if inconsistencyHook != "" {
				b.WriteString(inconsistencyHook)
			}
			b.WriteString("\n\n")
		}

		if shouldAttachAudit {
			if !analyticalIntent {
				b.WriteString("<details>\n<summary>📊 Ver Detalles Técnicos de Auditoría</summary>\n\n")
			}
			if contextDebt {
				b.WriteString("**ESTADO SEMANTICO: DESALINEADO ⚠️**\n\n")
			} else {
				b.WriteString("**ESTADO SEMÁNTICO: ALINEADO ✅**\n\n")
			}
			if len(relations) > 0 {
				b.WriteString("**Cadena Causal de Negocio:**\n")
				for _, rel := range relations {
					parts := strings.Split(rel, " -> ")
					if len(parts) == 2 {
						b.WriteString("- `")
						b.WriteString(parts[0])
						b.WriteString("` ➔ `")
						b.WriteString(parts[1])
						b.WriteString("`\n")
					} else {
						b.WriteString("- `")
						b.WriteString(rel)
						b.WriteString("`\n")
					}
				}
				b.WriteString("\n")
			} else {
				b.WriteString("**Cadena Causal de Negocio:**\n- Sin relaciones FK de negocio detectadas.\n\n")
			}
			b.WriteString("```yaml\n")
			b.WriteString("# Analisis de Prioridad\n")
			b.WriteString(fmt.Sprintf("Inconsistencia: %s\n", map[bool]string{true: "ACTIVA", false: "0%"}[contextDebt]))
			if contextDebt {
				b.WriteString(fmt.Sprintf("ContextDebt: %s\n", strings.Join(missing, ", ")))
			} else {
				b.WriteString("ContextDebt: Nominal\n")
			}
			b.WriteString("Proxima_Accion: Generar Snapshot post-mutacion\n")
			if deepAudit {
				b.WriteString("Filtro_de_Capas: DeepAudit (incluye internas)\n")
			} else {
				b.WriteString(fmt.Sprintf("Filtro_de_Capas: Activo (%d tablas internas ocultas)\n", hiddenInternalTables))
			}
			b.WriteString(fmt.Sprintf("Fisico_vs_Snapshot: %d/%d\n", physicalTables, semanticSnapshots))
			b.WriteString(fmt.Sprintf("Eventos_Engram: %d\n", memoryEvents))
			b.WriteString(fmt.Sprintf("Entropy: %s\n", strings.ToUpper(entropyState)))
			b.WriteString("```\n\n")
			b.WriteString("</details>\n\n")
		} else {
			b.WriteString("`Auditoría técnica oculta por defecto (pídela con \"ver auditoría\").`\n\n")
		}

		b.WriteString("---\n")
		if contextDebt {
			b.WriteString(fmt.Sprintf("**Firma semantica:** DESALINEADO (%d/%d snapshots)\n", semanticSnapshots, physicalTables))
		} else {
			b.WriteString(fmt.Sprintf("**Firma semantica:** ALINEADO (%d/%d snapshots)\n", semanticSnapshots, physicalTables))
		}
	}

	finalResponse := b.String()
	responseMode := "fallback"
	llmProvider := ""
	llmModel := ""
	fallbackReason := ""
	if llmResponse, servedProvider, servedModel, llmErr := h.generateArchitectLLMResponse(
		ctx,
		userPrompt,
		physicalTables,
		semanticSnapshots,
		memoryEvents,
		entropyState,
		missing,
		relations,
		recentChanges,
		explicitAudit,
		deepAudit,
		hiddenInternalTables,
		mentionInconsistencyHook,
	); llmErr == nil && strings.TrimSpace(llmResponse) != "" {
		finalResponse = llmResponse
		responseMode = "llm"
		llmProvider = servedProvider
		llmModel = servedModel
		logger.Log.Info().
			Str("module", "engram").
			Str("provider", servedProvider).
			Str("model", servedModel).
			Msg("RespondEngramArchitect served via LLM")
	} else if llmErr != nil {
		llmProvider = servedProvider
		llmModel = servedModel
		fallbackReason = sanitizeLLMError(llmErr)
		logger.Log.Warn().
			Err(llmErr).
			Str("module", "engram").
			Str("provider", servedProvider).
			Str("model", servedModel).
			Msg("RespondEngramArchitect fell back to deterministic response")
	}

	return c.JSON(http.StatusOK, engramArchitectResponse{
		Status:          "ok",
		Response:        finalResponse,
		PhysicalTables:  physicalTables,
		MemoryEvents:    memoryEvents,
		EntropyState:    entropyState,
		ContextDebt:     contextDebt,
		MissingEntities: missing,
		ResponseMode:    responseMode,
		LLMProvider:     llmProvider,
		LLMModel:        llmModel,
		FallbackReason:  fallbackReason,
	})
}

type mcpGuardrailDecision struct {
	Level           string
	AutonomyLevel   string
	GuardrailSource string
	Risk            string
	Action          string
	Reason          string
}

func normalizeMCPSecurityLevel(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case mcpSecurityLevelMedio:
		return mcpSecurityLevelMedio
	case mcpSecurityLevelRestringido:
		return mcpSecurityLevelRestringido
	default:
		return mcpSecurityLevelLibre
	}
}

func classifyMCPToolRisk(tool string) string {
	normalized := strings.ToLower(strings.TrimSpace(tool))
	if normalized == "" {
		return mcpToolRiskRead
	}

	readTools := map[string]struct{}{
		"system.health":    {},
		"collections.list": {},
		"vector.status":    {},
	}
	if _, ok := readTools[normalized]; ok {
		return mcpToolRiskRead
	}

	dangerousKeywords := []string{"delete", "drop", "alter", "truncate", "revoke"}
	for _, keyword := range dangerousKeywords {
		if strings.Contains(normalized, keyword) {
			return mcpToolRiskDangerous
		}
	}

	writeKeywords := []string{"create", "insert", "update", "enable", "disable", "fix", "enforce"}
	for _, keyword := range writeKeywords {
		if strings.Contains(normalized, keyword) {
			return mcpToolRiskSafeWrite
		}
	}

	return mcpToolRiskRead
}

func evaluateMCPGuardrail(level, tool string) mcpGuardrailDecision {
	normalizedLevel := normalizeMCPSecurityLevel(level)
	risk := classifyMCPToolRisk(tool)
	decision := mcpGuardrailDecision{
		Level:  normalizedLevel,
		Risk:   risk,
		Action: mcpGuardrailActionExecute,
	}

	switch normalizedLevel {
	case mcpSecurityLevelRestringido:
		if risk != mcpToolRiskRead {
			decision.Action = mcpGuardrailActionBlocked
			decision.Reason = "security level restringido allows read-only MCP tools"
		}
	case mcpSecurityLevelMedio:
		if risk == mcpToolRiskSafeWrite || risk == mcpToolRiskDangerous {
			decision.Action = mcpGuardrailActionPending
			decision.Reason = "security level medio requires approval for write tools"
		}
	case mcpSecurityLevelLibre:
		// libre is full access: execute read and write tools directly.
	}

	return decision
}


func (h *Handler) createMCPApproval(ctx context.Context, c echo.Context, tool string, args map[string]any, decision mcpGuardrailDecision) (string, error) {
	tokenID, _ := c.Get("api_key_id").(string)
	if strings.TrimSpace(tokenID) == "" {
		return "", errors.New("cannot queue MCP approval without api token context")
	}

	workspaceID, _ := c.Get("workspace_id").(string)
	workspaceID = strings.TrimSpace(workspaceID)
	actorSubject, _ := c.Get("user_id").(string)
	actorSubject = strings.TrimSpace(actorSubject)

	argumentsJSON, err := json.Marshal(args)
	if err != nil {
		return "", err
	}

	var approvalID string
	err = h.DB.Pool.QueryRow(ctx, `
		INSERT INTO _v_mcp_approvals (token_id, token_security_level, workspace_id, actor_subject, tool, arguments, status, reason)
		VALUES ($1::uuid, $2::mcp_security_level, NULLIF($3, '')::uuid, NULLIF($4, ''), $5, $6::jsonb, 'pending', $7)
		RETURNING id::text
	`, tokenID, decision.Level, workspaceID, actorSubject, tool, string(argumentsJSON), decision.Reason).Scan(&approvalID)
	if isMissingMCPSchemaError(err) {
		if schemaErr := h.ensureMCPApprovalsSchema(ctx); schemaErr != nil {
			return "", schemaErr
		}
		err = h.DB.Pool.QueryRow(ctx, `
			INSERT INTO _v_mcp_approvals (token_id, token_security_level, workspace_id, actor_subject, tool, arguments, status, reason)
			VALUES ($1::uuid, $2::mcp_security_level, NULLIF($3, '')::uuid, NULLIF($4, ''), $5, $6::jsonb, 'pending', $7)
			RETURNING id::text
		`, tokenID, decision.Level, workspaceID, actorSubject, tool, string(argumentsJSON), decision.Reason).Scan(&approvalID)
	}
	if err != nil {
		return "", err
	}

	return approvalID, nil
}

func (h *Handler) mcpAuditEvent(c echo.Context, tool string, args map[string]any, decision mcpGuardrailDecision, result string, latency time.Duration, err error) {
	ctx := c.Request().Context()
	event := logger.Log.Info()
	if err != nil {
		event = logger.Log.Warn().Err(err)
	}

	resolvedTokenID, _, resolvedAgentName, resolvedUserAgent := resolveMCPAgentIdentity(c)
	if strings.TrimSpace(resolvedTokenID) != "" {
		event = event.Str("agent_token_id", strings.TrimSpace(resolvedTokenID))
	}

	event.
		Str("module", "mcp_audit").
		Str("security_level", decision.Level).
		Str("effective_security_level", decision.Level).
		Str("guardrail_source", decision.GuardrailSource).
		Str("tool", strings.TrimSpace(tool)).
		Str("tool_risk", decision.Risk).
		Str("result", result).
		Int64("latency_ms", latency.Milliseconds()).
		Msg("mcp tool decision")

	userAgent := resolvedUserAgent
	cleanTool := strings.TrimSpace(tool)
	cleanTokenID := strings.TrimSpace(resolvedTokenID)
	isAwarenessSync := strings.EqualFold(cleanTool, "get_project_awareness")
	activityKind, pipelineFX := classifyMCPActivity(cleanTool, decision.Risk, result)
	operationDetail, targetResource := deriveMCPResourceDetails(cleanTool, args)
	statusMsg := getToolIntention(cleanTool)
	if strings.EqualFold(strings.TrimSpace(result), mcpGuardrailActionBlocked) {
		if forced, ok := c.Get("mcp_blocked_status_msg").(string); ok && strings.TrimSpace(forced) != "" {
			statusMsg = strings.TrimSpace(forced)
		} else {
			statusMsg = buildMCPBlockedStatusMessage(cleanTokenID, decision.Level, cleanTool, targetResource)
		}
	}
	now := time.Now().UTC()
	streamResult := strings.TrimSpace(result)
	if hardLock, _ := c.Get("mcp_hard_lock_required").(bool); hardLock {
		streamResult = "hard_lock_active"
	}
	securityAlertType := ""
	if strings.EqualFold(streamResult, "hard_lock_active") {
		securityAlertType = "hard_lock"
	} else if strings.EqualFold(streamResult, mcpGuardrailActionBlocked) {
		securityAlertType = "blocked"
	}
	if !isAwarenessSync {
		globalMCPStreamBroker.Publish(mcpStreamEvent{
			EventType:       "mcp_activity",
			Event:           "mcp_activity",
			AgentTokenID:    cleanTokenID,
			AgentName:       resolvedAgentName,
			UserAgent:       userAgent,
			Tool:            cleanTool,
			Result:          streamResult,
			StatusMsg:       statusMsg,
			SecurityLevel:   decision.Level,
			ToolRisk:        decision.Risk,
			ActivityKind:    activityKind,
			PipelineFX:      pipelineFX,
			TargetResource:  targetResource,
			OperationDetail: operationDetail,
			LatencyMS:       latency.Milliseconds(),
			Timestamp:       now,
		})
		if securityAlertType != "" {
			markMCPSecurityAlert(now)
			globalMCPStreamBroker.Publish(mcpStreamEvent{
				EventType:       "security_alert",
				Event:           "security_alert",
				AlertType:       securityAlertType,
				Critical:        true,
				AgentTokenID:    cleanTokenID,
				AgentName:       resolvedAgentName,
				UserAgent:       userAgent,
				Tool:            cleanTool,
				Result:          streamResult,
				StatusMsg:       statusMsg,
				SecurityLevel:   decision.Level,
				ToolRisk:        decision.Risk,
				ActivityKind:    mcpActivityKindAuth,
				PipelineFX:      mcpPipelineFXShield,
				TargetResource:  targetResource,
				OperationDetail: operationDetail,
				LatencyMS:       latency.Milliseconds(),
				Timestamp:       now,
			})
		}
	}
	h.registerMCPLiveSession(ctx, cleanTokenID, decision.Level, cleanTool, "active", resolvedAgentName, resolvedUserAgent, now)
	if !isAwarenessSync {
		if err := h.appendProjectEngram(c.Request().Context(), mcpStreamEvent{
			AgentTokenID:    cleanTokenID,
			AgentName:       resolvedAgentName,
			Tool:            cleanTool,
			Result:          streamResult,
			StatusMsg:       statusMsg,
			SecurityLevel:   decision.Level,
			ToolRisk:        decision.Risk,
			ActivityKind:    activityKind,
			PipelineFX:      pipelineFX,
			TargetResource:  targetResource,
			OperationDetail: operationDetail,
			LatencyMS:       latency.Milliseconds(),
			Timestamp:       now,
		}, args); err != nil {
			logger.Log.Warn().Err(err).Str("module", "mcp_audit").Msg("failed to append project engram")
		}
	}

	if !isAwarenessSync && shouldCaptureSemanticSnapshot(cleanTool, result) {
		h.captureSemanticSnapshot(c.Request().Context(), c, cleanTool, args, decision)
	}
	if !isAwarenessSync && shouldRunSemanticAutodoc(cleanTool, result) {
		targets := extractSemanticSnapshotTargets(cleanTool, args)
		if len(targets) > 0 && h != nil && h.DB != nil && h.DB.Pool != nil {
			go h.runSemanticAutodocWorker(cleanTokenID, resolvedAgentName, decision.Level, decision.Risk, cleanTool, targets)
		}
	}

	if (result == "executed" || result == "approved_executed") && cleanTokenID != "" {
		h.incrementMCPSkillUsage(c.Request().Context(), cleanTool)
		skillName, icon, ok := mcpSkillForTool(cleanTool)
		if ok && registerMCPSkillForToken(cleanTokenID, skillName) {
			globalMCPStreamBroker.Publish(mcpStreamEvent{
				EventType:       "skill_installed",
				Event:           "skill_installed",
				AgentTokenID:    cleanTokenID,
				AgentName:       resolvedAgentName,
				UserAgent:       userAgent,
				Tool:            cleanTool,
				Result:          strings.TrimSpace(result),
				StatusMsg:       "ha desbloqueado una nueva habilidad del servidor.",
				SkillID:         mcpSkillIDByTool[cleanTool],
				SecurityLevel:   decision.Level,
				ToolRisk:        decision.Risk,
				ActivityKind:    mcpActivityKindSystem,
				PipelineFX:      mcpPipelineFXFlow,
				TargetResource:  targetResource,
				OperationDetail: operationDetail,
				SkillName:       skillName,
				Icon:            icon,
				Timestamp:       now,
			})
		}
	}
}

func registerMCPSkillForToken(tokenID, skillName string) bool {
	tokenID = strings.TrimSpace(tokenID)
	skillName = strings.TrimSpace(skillName)
	if tokenID == "" || skillName == "" {
		return false
	}

	mcpLearnedSkillsMu.Lock()
	defer mcpLearnedSkillsMu.Unlock()
	skills, ok := mcpLearnedSkills[tokenID]
	if !ok {
		skills = map[string]struct{}{}
		mcpLearnedSkills[tokenID] = skills
	}
	if _, exists := skills[skillName]; exists {
		return false
	}
	skills[skillName] = struct{}{}
	return true
}

func getToolIntention(toolName string) string {
	intentions := map[string]string{
		"create_table":        "esta disenando un nuevo esquema de datos...",
		"collections.create":  "esta disenando un nuevo esquema de datos...",
		"collections.list":    "esta explorando tus colecciones actuales...",
		"system.health":       "esta revisando la salud general del sistema...",
		"enable_rls":          "esta reforzando la seguridad de una tabla...",
		"policies.enable_rls": "esta reforzando la seguridad de una tabla...",
		"vector.status":       "esta verificando la capa de busqueda semantica...",
		"nlq.translate":       "esta traduciendo lenguaje natural a consultas precisas...",
		"nlq.query":           "esta ejecutando una consulta inteligente sobre tus datos...",
	}
	if msg, ok := intentions[strings.TrimSpace(toolName)]; ok {
		return msg
	}
	return "esta procesando una solicitud..."
}

func buildMCPBlockedStatusMessage(agentTokenID, securityLevel, toolName, targetResource string) string {
	agentTokenID = strings.TrimSpace(agentTokenID)
	securityLevel = strings.TrimSpace(securityLevel)
	toolName = strings.TrimSpace(toolName)
	targetResource = strings.TrimSpace(targetResource)
	if agentTokenID == "" {
		agentTokenID = "unknown_agent"
	}
	if securityLevel == "" {
		securityLevel = "unknown_level"
	}
	if toolName == "" {
		toolName = "unknown_tool"
	}
	if targetResource == "" {
		targetResource = "unknown_target"
	}
	return fmt.Sprintf(
		"INTENTO DE MUTACIÓN NO AUTORIZADO: El agente [%s] con nivel [%s] intentó ejecutar [%s] sobre [%s].",
		agentTokenID,
		securityLevel,
		toolName,
		targetResource,
	)
}

func inferMCPAgentName(userAgent string) string {
	normalized := strings.ToLower(strings.TrimSpace(userAgent))
	switch {
	case strings.Contains(normalized, "cursor"):
		return "Cursor"
	case strings.Contains(normalized, "windsurf"):
		return "Windsurf"
	case strings.Contains(normalized, "cline"):
		return "Cline"
	case strings.Contains(normalized, "roo"):
		return "Roo"
	case strings.Contains(normalized, "continue"):
		return "Continue"
	case strings.Contains(normalized, "aider"):
		return "Aider"
	case strings.Contains(normalized, "zed"):
		return "Zed"
	case strings.Contains(normalized, "jetbrains"), strings.Contains(normalized, "intellij"):
		return "JetBrains"
	case strings.Contains(normalized, "gemini"):
		return "Gemini"
	case strings.Contains(normalized, "codex"):
		return "Codex"
	case strings.Contains(normalized, "claude"):
		return "Claude"
	case strings.Contains(normalized, "vscode"), strings.Contains(normalized, "visual studio code"), strings.Contains(normalized, "copilot"):
		return "VSCode"
	case strings.Contains(normalized, "python"):
		return "Python-Agent"
	default:
		return "MCP Agent"
	}
}

func extractMCPClientName(params map[string]any) string {
	if len(params) == 0 {
		return ""
	}

	if raw, ok := params["clientInfo"]; ok {
		if clientInfo, ok := raw.(map[string]any); ok {
			if name := strings.TrimSpace(fmt.Sprintf("%v", clientInfo["name"])); name != "" && name != "<nil>" {
				return name
			}
		}
	}

	if raw, ok := params["client"]; ok {
		if client, ok := raw.(map[string]any); ok {
			if name := strings.TrimSpace(fmt.Sprintf("%v", client["name"])); name != "" && name != "<nil>" {
				return name
			}
		}
	}

	if name := strings.TrimSpace(fmt.Sprintf("%v", params["name"])); name != "" && name != "<nil>" {
		return name
	}

	if name := strings.TrimSpace(fmt.Sprintf("%v", params["client_name"])); name != "" && name != "<nil>" {
		return name
	}

	if name := strings.TrimSpace(fmt.Sprintf("%v", params["editor"])); name != "" && name != "<nil>" {
		return name
	}

	return ""
}

func normalizeMCPClientDisplayName(raw, fallback string) string {
	name := strings.TrimSpace(raw)
	if name == "" || name == "<nil>" {
		return strings.TrimSpace(fallback)
	}

	normalized := strings.ToLower(name)
	switch {
	case strings.Contains(normalized, "cursor"):
		return "Cursor"
	case strings.Contains(normalized, "windsurf"):
		return "Windsurf"
	case strings.Contains(normalized, "cline"):
		return "Cline"
	case strings.Contains(normalized, "roo"):
		return "Roo"
	case strings.Contains(normalized, "continue"):
		return "Continue"
	case strings.Contains(normalized, "aider"):
		return "Aider"
	case strings.Contains(normalized, "zed"):
		return "Zed"
	case strings.Contains(normalized, "jetbrains"), strings.Contains(normalized, "intellij"):
		return "JetBrains"
	case strings.Contains(normalized, "gemini"):
		return "Gemini"
	case strings.Contains(normalized, "codex"):
		return "Codex"
	case strings.Contains(normalized, "vscode"), strings.Contains(normalized, "visual studio code"), strings.Contains(normalized, "copilot"):
		return "VSCode"
	case strings.Contains(normalized, "claude"):
		return "Claude"
	case strings.Contains(normalized, "python"):
		return "Python-Agent"
	default:
		return name
	}
}

func normalizeMCPAgentToken(raw string) string {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" {
		return ""
	}

	var out strings.Builder
	out.Grow(len(normalized))
	for _, r := range normalized {
		switch {
		case r >= 'a' && r <= 'z':
			out.WriteRune(r)
		case r >= '0' && r <= '9':
			out.WriteRune(r)
		case r == '-' || r == '_':
			out.WriteRune(r)
		default:
			out.WriteByte('-')
		}
	}

	return strings.Trim(out.String(), "-")
}

func shortMCPHash(parts ...string) string {
	h := fnv.New64a()
	for _, part := range parts {
		_, _ = h.Write([]byte(part))
		_, _ = h.Write([]byte{'|'})
	}
	return strconv.FormatUint(h.Sum64(), 16)
}

func isUUIDLike(raw string) bool {
	value := strings.ToLower(strings.TrimSpace(raw))
	if len(value) != 36 {
		return false
	}
	for i, r := range value {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
				return false
			}
		}
	}
	return true
}

func resolveMCPAgentIdentity(c echo.Context) (tokenID string, level string, name string, userAgent string) {
	userAgent = strings.TrimSpace(c.Request().UserAgent())
	level = normalizeMCPSecurityLevel(strings.TrimSpace(getStringFromContext(c, "api_key_security_level")))
	name = inferMCPAgentName(userAgent)

	if rawTokenID := strings.TrimSpace(getStringFromContext(c, "api_key_id")); rawTokenID != "" {
		return rawTokenID, level, name, userAgent
	}

	if prefix := normalizeMCPAgentToken(getStringFromContext(c, "api_key_prefix")); prefix != "" {
		return "api-" + prefix, level, name, userAgent
	}

	if userID := normalizeMCPAgentToken(userIDFromContext(c)); userID != "" {
		return "user-" + userID, level, name, userAgent
	}

	role := strings.ToLower(strings.TrimSpace(roleFromContext(c)))
	if role == "" && c.Get("is_service_role") == true {
		role = "service_role"
	}
	if role == "" {
		role = "unknown"
	}

	return "bridge-" + shortMCPHash(role, userAgent), level, name, userAgent
}

func (h *Handler) resolveEffectiveMCPSecurityLevel(ctx context.Context, c echo.Context, tokenID string) (string, string) {
	if level := strings.TrimSpace(getStringFromContext(c, "api_key_security_level")); level != "" {
		return normalizeMCPSecurityLevel(level), "api_key"
	}

	trimmedToken := strings.TrimSpace(tokenID)
	canonicalToken := canonicalMCPTokenID(trimmedToken)
	if canonicalToken != "" {
		mcpLiveSessionsMu.Lock()
		if override, ok := mcpAgentOverrides[canonicalToken]; ok {
			if overrideLevel := strings.TrimSpace(override.SecurityLevel); overrideLevel != "" {
				mcpLiveSessionsMu.Unlock()
				return normalizeMCPSecurityLevel(overrideLevel), "session_override"
			}
		}
		for key, current := range mcpLiveSessions {
			if mcpTokenMatches(current.TokenID, trimmedToken) || mcpTokenMatches(key, trimmedToken) {
				if sessionLevel := strings.TrimSpace(current.SecurityLevel); sessionLevel != "" {
					mcpLiveSessionsMu.Unlock()
					return normalizeMCPSecurityLevel(sessionLevel), "live_session"
				}
			}
		}
		mcpLiveSessionsMu.Unlock()
	}

	if h != nil && h.DB != nil && h.DB.Pool != nil && trimmedToken != "" {
		var level string
		err := h.DB.Pool.QueryRow(ctx, `
			SELECT COALESCE(NULLIF(BTRIM(security_level), ''), 'restringido')
			FROM "_v_active_mcp_sessions"
			WHERE lower(agent_id) = lower($1) OR lower(agent_id) LIKE lower($1) || '@%'
			ORDER BY last_seen DESC
			LIMIT 1
		`, trimmedToken).Scan(&level)
		if err == nil && strings.TrimSpace(level) != "" {
			return normalizeMCPSecurityLevel(level), "active_session"
		}
	}

	return mcpSecurityLevelRestringido, "fallback"
}


func getStringFromContext(c echo.Context, key string) string {
	value, _ := c.Get(key).(string)
	return strings.TrimSpace(value)
}

func containsAnyToken(value string, tokens ...string) bool {
	for _, token := range tokens {
		if strings.Contains(value, token) {
			return true
		}
	}
	return false
}

func classifyMCPActivity(toolName, toolRisk, result string) (string, string) {
	tool := strings.ToLower(strings.TrimSpace(toolName))
	risk := strings.ToLower(strings.TrimSpace(toolRisk))
	outcome := strings.ToLower(strings.TrimSpace(result))

	isAuthTool := containsAnyToken(tool, "rls", "policy", "auth", "grant", "revoke")
	isSchemaTool := containsAnyToken(tool, "create", "alter", "drop", "rename", "migrate", "schema", "table")

	if containsAnyToken(outcome, "blocked", "denied", "reject", "error", "unknown_tool") {
		if isAuthTool {
			return mcpActivityKindAuth, mcpPipelineFXShield
		}
		return mcpActivityKindSystem, mcpPipelineFXWarp
	}

	if isAuthTool {
		return mcpActivityKindAuth, mcpPipelineFXShield
	}

	if isSchemaTool || risk == mcpToolRiskDangerous {
		return mcpActivityKindWrite, mcpPipelineFXWarp
	}

	if risk == mcpToolRiskSafeWrite {
		return mcpActivityKindWrite, mcpPipelineFXFlow
	}

	if containsAnyToken(tool, "list", "get", "select", "describe", "health", "status", "query", "read") || risk == mcpToolRiskRead {
		return mcpActivityKindRead, mcpPipelineFXPulse
	}

	return mcpActivityKindSystem, mcpPipelineFXFlow
}

func firstStringValue(args map[string]any, keys ...string) string {
	if len(args) == 0 {
		return ""
	}
	for _, key := range keys {
		value, ok := args[key]
		if !ok {
			continue
		}
		text := strings.TrimSpace(fmt.Sprintf("%v", value))
		if text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func deriveMCPResourceDetails(toolName string, args map[string]any) (string, string) {
	tool := strings.ToLower(strings.TrimSpace(toolName))

	if containsAnyToken(tool, "enable_rls", "policies.enable_rls") {
		target := firstStringValue(args, "table", "table_name", "name", "target")
		return "ENABLE RLS", target
	}

	if containsAnyToken(tool, "drop", "delete") {
		target := firstStringValue(args, "table", "table_name", "column", "index", "name", "target")
		if containsAnyToken(tool, "column") {
			return "DROP COLUMN", target
		}
		if containsAnyToken(tool, "index") {
			return "DROP INDEX", target
		}
		if containsAnyToken(tool, "table") {
			return "DROP TABLE", target
		}
		return "DELETE", target
	}

	if containsAnyToken(tool, "create") {
		target := firstStringValue(args, "table", "table_name", "name", "collection", "index", "target")
		if containsAnyToken(tool, "index") {
			return "CREATE INDEX", target
		}
		if containsAnyToken(tool, "table", "collection") {
			return "CREATE TABLE", target
		}
		return "CREATE", target
	}

	if containsAnyToken(tool, "alter", "update", "upsert", "rename") {
		target := firstStringValue(args, "table", "table_name", "name", "target", "collection")
		if containsAnyToken(tool, "alter") {
			return "ALTER TABLE", target
		}
		if containsAnyToken(tool, "rename") {
			return "RENAME", target
		}
		return "UPDATE", target
	}

	if containsAnyToken(tool, "list", "status", "health", "query", "read", "get", "select") {
		target := firstStringValue(args, "table", "table_name", "collection", "name", "target")
		if target == "" {
			target = "system"
		}
		if containsAnyToken(tool, "health", "status") {
			return "HEALTH CHECK", target
		}
		if containsAnyToken(tool, "list") {
			return "LIST", target
		}
		if containsAnyToken(tool, "query", "select") {
			return "QUERY", target
		}
		return "READ", target
	}

	target := firstStringValue(args, "table", "table_name", "name", "target", "collection")
	if target == "" {
		target = "system"
	}
	return strings.ToUpper(strings.ReplaceAll(toolName, ".", " ")), target
}

func isDestructiveMCPOperation(tool, operationDetail string) bool {
	combined := strings.ToLower(strings.TrimSpace(tool + " " + operationDetail))
	return containsAnyToken(combined, "drop", "truncate", "delete_all", "delete-all")
}

func issueMCPDestructionChallenge(agentID, tool, target string) string {
	now := time.Now().UTC()
	token := "dlk_" + shortMCPHash(agentID, tool, target, now.Format(time.RFC3339Nano))
	challenge := mcpDestructionChallenge{
		Token:     token,
		AgentID:   strings.TrimSpace(agentID),
		Tool:      strings.TrimSpace(tool),
		Target:    strings.TrimSpace(target),
		CreatedAt: now,
		ExpiresAt: now.Add(2 * time.Minute),
	}
	mcpDestructionMu.Lock()
	mcpDestructionMap[token] = challenge
	mcpDestructionMu.Unlock()
	return token
}

func consumeMCPDestructionChallenge(token, agentID, tool, target string) bool {
	token = strings.TrimSpace(token)
	if token == "" {
		return false
	}
	now := time.Now().UTC()

	mcpDestructionMu.Lock()
	defer mcpDestructionMu.Unlock()

	for k, challenge := range mcpDestructionMap {
		if now.After(challenge.ExpiresAt) {
			delete(mcpDestructionMap, k)
		}
	}

	challenge, ok := mcpDestructionMap[token]
	if !ok {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(challenge.AgentID), strings.TrimSpace(agentID)) {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(challenge.Tool), strings.TrimSpace(tool)) {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(challenge.Target), strings.TrimSpace(target)) {
		return false
	}
	delete(mcpDestructionMap, token)
	return true
}

func (h *Handler) isMCPProtectedTarget(ctx context.Context, target string) (bool, error) {
	target = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(target, "public.")))
	if target == "" || target == "system" || target == "unknown_target" {
		return false, nil
	}

	var protected bool
	err := h.DB.Pool.QueryRow(ctx, `SELECT COALESCE(is_protected, false) FROM _v_collections WHERE name = $1 LIMIT 1`, target).Scan(&protected)
	if err == nil {
		if protected {
			return true, nil
		}
		// fallback hardcoded critical roots
		return target == "pc" || target == "usuarios" || target == "conexiones", nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return target == "pc" || target == "usuarios" || target == "conexiones", nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "42703" {
		// column is_protected missing -> fallback policy
		return target == "pc" || target == "usuarios" || target == "conexiones", nil
	}
	return false, err
}

func deriveMCPEventCausalRef(args map[string]any) string {
	if args == nil {
		return ""
	}
	for _, key := range []string{"causal_ref", "cause_id", "parent_event_id", "trigger_event_id"} {
		raw, ok := args[key]
		if !ok || raw == nil {
			continue
		}
		value := strings.TrimSpace(fmt.Sprintf("%v", raw))
		if value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}

func shouldCaptureSemanticSnapshot(tool, result string) bool {
	outcome := strings.ToLower(strings.TrimSpace(result))
	if outcome != "executed" && outcome != "approved_executed" {
		return false
	}
	normalizedTool := strings.ToLower(strings.TrimSpace(tool))
	return containsAnyToken(normalizedTool, "create_table", "collections.create", "enable_rls", "policies.enable_rls", "alter", "schema")
}

func extractSemanticSnapshotTargets(tool string, args map[string]any) []string {
	targets := make([]string, 0, 2)
	add := func(value string) {
		value = strings.TrimSpace(strings.ToLower(value))
		value = strings.TrimPrefix(value, "public.")
		if value == "" || value == "system" {
			return
		}
		for _, current := range targets {
			if current == value {
				return
			}
		}
		targets = append(targets, value)
	}

	add(firstStringValue(args, "table", "table_name", "name", "collection", "target"))
	if len(targets) == 0 {
		if _, inferred := deriveMCPResourceDetails(tool, args); inferred != "" {
			add(inferred)
		}
	}
	return targets
}

func (h *Handler) captureSemanticSnapshot(ctx context.Context, c echo.Context, tool string, args map[string]any, decision mcpGuardrailDecision) {
	targets := extractSemanticSnapshotTargets(tool, args)
	if len(targets) == 0 {
		return
	}

	tokenID, _, agentName, _ := resolveMCPAgentIdentity(c)
	now := time.Now().UTC()

	for _, table := range targets {
		columnRows, err := h.DB.Pool.Query(ctx, `
			SELECT column_name, data_type
			FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = $1
			ORDER BY ordinal_position
		`, table)
		if err != nil {
			continue
		}

		columns := make([]string, 0, 16)
		for columnRows.Next() {
			var name, dtype string
			if scanErr := columnRows.Scan(&name, &dtype); scanErr == nil {
				columns = append(columns, fmt.Sprintf("%s:%s", strings.ToLower(name), strings.ToLower(dtype)))
			}
		}
		columnRows.Close()
		if len(columns) == 0 {
			continue
		}

		fkRows, fkErr := h.DB.Pool.Query(ctx, `
			SELECT kcu.column_name, ccu.table_name, ccu.column_name
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu
			  ON tc.constraint_name = kcu.constraint_name
			 AND tc.table_schema = kcu.table_schema
			JOIN information_schema.constraint_column_usage ccu
			  ON ccu.constraint_name = tc.constraint_name
			 AND ccu.table_schema = tc.table_schema
			WHERE tc.constraint_type = 'FOREIGN KEY'
			  AND tc.table_schema = 'public'
			  AND tc.table_name = $1
		`, table)

		relations := make([]string, 0, 8)
		if fkErr == nil {
			for fkRows.Next() {
				var col, refTable, refCol string
				if scanErr := fkRows.Scan(&col, &refTable, &refCol); scanErr == nil {
					relations = append(relations, fmt.Sprintf("%s->%s.%s", strings.ToLower(col), strings.ToLower(refTable), strings.ToLower(refCol)))
				}
			}
			fkRows.Close()
		}

		snapshotMsg := "Semantic Snapshot auto-documentado tras mutacion MCP."
		if len(relations) > 0 {
			snapshotMsg = snapshotMsg + " Relaciones detectadas: " + strings.Join(relations, ", ") + "."
		}

		payload := map[string]any{
			"source_tool": tool,
			"table":       table,
			"columns":     columns,
			"relations":   relations,
		}
		_ = h.appendProjectEngram(ctx, mcpStreamEvent{
			AgentTokenID:    tokenID,
			AgentName:       agentName,
			Tool:            "schema.semantic_snapshot",
			OperationDetail: "SEMANTIC SNAPSHOT",
			TargetResource:  table,
			ActivityKind:    mcpActivityKindWrite,
			PipelineFX:      mcpPipelineFXFlow,
			SecurityLevel:   decision.Level,
			ToolRisk:        decision.Risk,
			Result:          "captured",
			StatusMsg:       snapshotMsg,
			LatencyMS:       0,
			Timestamp:       now,
		}, payload)
	}
}

func shouldRunSemanticAutodoc(tool, result string) bool {
	outcome := strings.ToLower(strings.TrimSpace(result))
	if outcome != "executed" && outcome != "approved_executed" {
		return false
	}
	normalizedTool := strings.ToLower(strings.TrimSpace(tool))
	return normalizedTool == "create_table" || normalizedTool == "collections.create"
}

func fallbackSemanticDescription(table string, columns []string, relations []string) string {
	normalized := strings.ToLower(strings.TrimSpace(table))
	switch normalized {
	case "pc":
		return "Nodo raíz de estaciones de trabajo; soporta sesiones y conectividad del ecosistema gaming."
	case "conexiones":
		return "Capa de conectividad de red por estación (`pc`), usada para validar disponibilidad operativa."
	case "roblox", "minecraft":
		return "Capa de sesión de juego vinculada a infraestructura `pc`; depende de conectividad y disponibilidad de estación."
	case "usuarios":
		return "Registro de identidad operativa de usuarios con atributos de acceso y estado."
	}
	if len(relations) > 0 {
		return "Entidad relacional con dependencias activas; su propósito principal es mantener consistencia de flujo entre módulos conectados."
	}
	if len(columns) > 0 {
		return "Entidad de dominio para persistencia estructurada de datos operativos del proyecto."
	}
	return "Entidad de dominio detectada; se recomienda completar semántica de negocio explícita."
}

func (h *Handler) generateSemanticDescription(ctx context.Context, table string, columns []string, relations []string) (string, string) {
	apiKey, err := h.loadEngramLLMAPIKey(ctx)
	if err != nil || strings.TrimSpace(apiKey) == "" {
		return fallbackSemanticDescription(table, columns, relations), "fallback"
	}

	provider := inferEngramLLMProvider(apiKey)
	prompt := fmt.Sprintf(
		"Resume en 1-2 oraciones tecnicas el proposito de la tabla '%s' en un BaaS. Columnas: %s. Relaciones: %s. No uses relleno, solo impacto de negocio e integridad.",
		table,
		strings.Join(columns, ", "),
		strings.Join(relations, ", "),
	)
	var endpoint string
	var reqBody any
	headers := map[string]string{
		"Content-Type": "application/json",
		"Accept":       "application/json",
	}

	switch provider {
	case "gemini":
		endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + url.QueryEscape(strings.TrimSpace(apiKey))
		reqBody = map[string]any{
			"contents": []map[string]any{
				{"parts": []map[string]any{{"text": prompt}}},
			},
		}
	case "openrouter":
		endpoint = "https://openrouter.ai/api/v1/chat/completions"
		headers["Authorization"] = "Bearer " + strings.TrimSpace(apiKey)
		headers["HTTP-Referer"] = "https://ozybase.local"
		headers["X-Title"] = "OzyBase Architect"
		reqBody = map[string]any{
			"model": "openai/gpt-4o-mini",
			"messages": []map[string]any{
				{"role": "system", "content": "Eres un arquitecto de datos BaaS. Responde conciso."},
				{"role": "user", "content": prompt},
			},
			"temperature": 0.2,
		}
	default:
		provider = "openai"
		endpoint = "https://api.openai.com/v1/chat/completions"
		headers["Authorization"] = "Bearer " + strings.TrimSpace(apiKey)
		reqBody = map[string]any{
			"model": "gpt-4o-mini",
			"messages": []map[string]any{
				{"role": "system", "content": "Eres un arquitecto de datos BaaS. Responde conciso."},
				{"role": "user", "content": prompt},
			},
			"temperature": 0.2,
		}
	}

	payload, _ := json.Marshal(reqBody)
	req, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if reqErr != nil {
		return fallbackSemanticDescription(table, columns, relations), provider + ":fallback"
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if provider == "gemini" {
		req.Header.Set("x-goog-api-key", strings.TrimSpace(apiKey))
	}

	client := &http.Client{Timeout: 8 * time.Second}
	res, callErr := client.Do(req)
	if callErr != nil {
		return fallbackSemanticDescription(table, columns, relations), provider + ":fallback"
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fallbackSemanticDescription(table, columns, relations), provider + ":fallback"
	}

	var raw map[string]any
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&raw); err != nil {
		return fallbackSemanticDescription(table, columns, relations), provider + ":fallback"
	}

	extractText := func(v any) string {
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	}
	// Gemini
	if provider == "gemini" {
		if candidates, ok := raw["candidates"].([]any); ok && len(candidates) > 0 {
			if c0, ok := candidates[0].(map[string]any); ok {
				if content, ok := c0["content"].(map[string]any); ok {
					if parts, ok := content["parts"].([]any); ok && len(parts) > 0 {
						if p0, ok := parts[0].(map[string]any); ok {
							if text := extractText(p0["text"]); text != "" && text != "<nil>" {
								return text, provider
							}
						}
					}
				}
			}
		}
		return fallbackSemanticDescription(table, columns, relations), provider + ":fallback"
	}
	// OpenAI chat completions
	if choices, ok := raw["choices"].([]any); ok && len(choices) > 0 {
		if c0, ok := choices[0].(map[string]any); ok {
			if msg, ok := c0["message"].(map[string]any); ok {
				if text := extractText(msg["content"]); text != "" && text != "<nil>" {
					return text, provider
				}
			}
		}
	}
	return fallbackSemanticDescription(table, columns, relations), provider + ":fallback"
}

func extractLLMTextByProvider(provider string, raw map[string]any) string {
	extractText := func(v any) string {
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	}
	if provider == "gemini" {
		if candidates, ok := raw["candidates"].([]any); ok && len(candidates) > 0 {
			if c0, ok := candidates[0].(map[string]any); ok {
				if content, ok := c0["content"].(map[string]any); ok {
					if parts, ok := content["parts"].([]any); ok && len(parts) > 0 {
						if p0, ok := parts[0].(map[string]any); ok {
							if text := extractText(p0["text"]); text != "" && text != "<nil>" {
								return text
							}
						}
					}
				}
			}
		}
		return ""
	}
	if choices, ok := raw["choices"].([]any); ok && len(choices) > 0 {
		if c0, ok := choices[0].(map[string]any); ok {
			if msg, ok := c0["message"].(map[string]any); ok {
				if text := extractText(msg["content"]); text != "" && text != "<nil>" {
					return text
				}
			}
		}
	}
	return ""
}

func sanitizeLLMError(err error) string {
	if err == nil {
		return ""
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		return "llm_error"
	}
	msg = strings.ReplaceAll(msg, "\n", " ")
	msg = strings.ReplaceAll(msg, "\r", " ")
	msg = strings.Join(strings.Fields(msg), " ")
	if len(msg) > 220 {
		msg = msg[:220] + "..."
	}
	return msg
}

func (h *Handler) generateArchitectLLMResponse(
	ctx context.Context,
	userPrompt string,
	physicalTables int,
	semanticSnapshots int64,
	memoryEvents int64,
	entropyState string,
	missing []string,
	relations []string,
	recentChanges []string,
	explicitAudit bool,
	deepAudit bool,
	hiddenInternalTables int,
	mentionInconsistencyHook bool,
) (string, string, string, error) {
	apiKey, err := h.loadEngramLLMAPIKey(ctx)
	if err != nil {
		return "", "", "", err
	}
	if strings.TrimSpace(apiKey) == "" {
		return "", "", "", errors.New("llm api key not configured")
	}

	provider := inferEngramLLMProvider(apiKey)
	contextDebt := len(missing) > 0 || int64(physicalTables) > semanticSnapshots
	hook := ""
	if contextDebt && mentionInconsistencyHook {
		targets := missing
		if len(targets) == 0 {
			targets = []string{"esquema y memoria"}
		}
		hook = "...pero tenemos tablas sin snapshot semántico en " + strings.Join(targets, ", ") + ". Aclaración: las tablas físicas sí existen; falta su contexto/snapshot en Engram."
	}

	grounding := map[string]any{
		"physical_tables":            physicalTables,
		"semantic_snapshots":         semanticSnapshots,
		"memory_events":              memoryEvents,
		"entropy_state":              strings.ToUpper(strings.TrimSpace(entropyState)),
		"missing_tables":             missing,
		"fk_relations":               relations,
		"recent_changes":             recentChanges,
		"explicit_audit":             explicitAudit,
		"deep_audit":                 deepAudit,
		"hidden_internal_tables":     hiddenInternalTables,
		"required_hook":              hook,
		"mention_inconsistency_hook": mentionInconsistencyHook,
	}
	groundingJSON, _ := json.Marshal(grounding)

	systemPrompt := strings.TrimSpace(`
Eres OzyEngram, socio técnico senior.
Responde SIEMPRE como ingeniero humano, breve y pragmático.

Reglas obligatorias:
1) Si el prompt es trivial/corto, responde en una sola línea natural.
2) Solo cierra con el hook exacto provisto en required_hook cuando mention_inconsistency_hook=true y required_hook no vacío.
   Incluye ese hook una sola vez; no repitas la misma inconsistencia dos veces en la respuesta.
3) Formato por defecto (sin auditoría): 
   - "Respuesta directa:" (1-2 líneas)
   - "Tablas sin snapshot semántico:" en UNA sola línea separada por comas (si aplica)
   - "Últimos cambios:" usando recent_changes (si el usuario lo pide)
   - "Siguiente paso recomendado:" (1 línea accionable)
4) Prohibido usar bloques markdown, tablas markdown o backticks, salvo explicit_audit=true o deep_audit=true.
5) No muestres auditoría pesada por defecto.
6) Solo agrega bloque <details> con cadena causal/FKs cuando explicit_audit=true o deep_audit=true.
7) Usa únicamente el grounding entregado, no inventes tablas ni estados.
8) Cuando menciones tablas concretas, envuelve el nombre con backticks (ej: ` + "`pc`" + `, ` + "`conexiones`" + `) para que se destaquen visualmente.
9) IMPORTANTE: missing_tables significa "tablas físicas que existen pero aún no tienen snapshot semántico", NO significa que la tabla no exista en base de datos.
`)

	userMessage := "Consulta del usuario:\n" + userPrompt + "\n\nGrounding JSON:\n" + string(groundingJSON)

	type llmAttempt struct {
		provider string
		model    string
		endpoint string
		body     any
		headers  map[string]string
	}

	attempts := make([]llmAttempt, 0, 3)
	switch provider {
	case "gemini":
		geminiPrompt := systemPrompt + "\n\n" + userMessage
		geminiBody := map[string]any{
			"contents": []map[string]any{
				{"parts": []map[string]any{{"text": geminiPrompt}}},
			},
		}
		commonHeaders := map[string]string{
			"Content-Type":   "application/json",
			"Accept":         "application/json",
			"x-goog-api-key": strings.TrimSpace(apiKey),
		}
		attempts = append(attempts,
			llmAttempt{
				provider: "gemini",
				model:    "gemini-2.5-flash",
				endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + url.QueryEscape(strings.TrimSpace(apiKey)),
				body:     geminiBody,
				headers:  commonHeaders,
			},
			llmAttempt{
				provider: "gemini",
				model:    "gemini-2.0-flash",
				endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + url.QueryEscape(strings.TrimSpace(apiKey)),
				body:     geminiBody,
				headers:  commonHeaders,
			},
		)
	case "openrouter":
		attempts = append(attempts, llmAttempt{
			provider: "openrouter",
			model:    "openai/gpt-4o-mini",
			endpoint: "https://openrouter.ai/api/v1/chat/completions",
			headers: map[string]string{
				"Content-Type":  "application/json",
				"Accept":        "application/json",
				"Authorization": "Bearer " + strings.TrimSpace(apiKey),
				"HTTP-Referer":  "https://ozybase.local",
				"X-Title":       "OzyBase Architect",
			},
			body: map[string]any{
				"model": "openai/gpt-4o-mini",
				"messages": []map[string]any{
					{"role": "system", "content": systemPrompt},
					{"role": "user", "content": userMessage},
				},
				"temperature": 0.2,
			},
		})
	default:
		provider = "openai"
		attempts = append(attempts, llmAttempt{
			provider: "openai",
			model:    "gpt-4o-mini",
			endpoint: "https://api.openai.com/v1/chat/completions",
			headers: map[string]string{
				"Content-Type":  "application/json",
				"Accept":        "application/json",
				"Authorization": "Bearer " + strings.TrimSpace(apiKey),
			},
			body: map[string]any{
				"model": "gpt-4o-mini",
				"messages": []map[string]any{
					{"role": "system", "content": systemPrompt},
					{"role": "user", "content": userMessage},
				},
				"temperature": 0.2,
			},
		})
	}

	client := &http.Client{Timeout: 12 * time.Second}
	var lastErr error
	lastProvider := provider
	lastModel := ""

	for idx, attempt := range attempts {
		lastProvider = attempt.provider
		lastModel = attempt.model
		payload, _ := json.Marshal(attempt.body)
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, attempt.endpoint, bytes.NewReader(payload))
		if reqErr != nil {
			lastErr = reqErr
			continue
		}
		for k, v := range attempt.headers {
			req.Header.Set(k, v)
		}

		res, callErr := client.Do(req)
		if callErr != nil {
			lastErr = callErr
			if idx < len(attempts)-1 {
				time.Sleep(350 * time.Millisecond)
			}
			continue
		}

		bodyBytes, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			lastErr = fmt.Errorf("llm status %d (%s/%s): %s", res.StatusCode, attempt.provider, attempt.model, strings.TrimSpace(string(bodyBytes)))
			if (res.StatusCode == http.StatusTooManyRequests || res.StatusCode == http.StatusServiceUnavailable) && idx < len(attempts)-1 {
				time.Sleep(450 * time.Millisecond)
				continue
			}
			continue
		}

		var raw map[string]any
		if err := json.Unmarshal(bodyBytes, &raw); err != nil {
			lastErr = err
			continue
		}
		text := strings.TrimSpace(extractLLMTextByProvider(attempt.provider, raw))
		if text == "" {
			lastErr = errors.New("empty llm response")
			continue
		}
		return text, attempt.provider, attempt.model, nil
	}

	if lastErr == nil {
		lastErr = errors.New("llm request failed")
	}
	return "", lastProvider, lastModel, lastErr
}

type engramCompactionEvent struct {
	ID             int64
	Tool           string
	Operation      string
	TargetResource string
	Result         string
	StatusMsg      string
	CreatedAt      time.Time
	Arguments      map[string]any
}

func trimJSONFence(text string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "```") {
		trimmed = strings.TrimPrefix(trimmed, "```json")
		trimmed = strings.TrimPrefix(trimmed, "```")
		trimmed = strings.TrimSuffix(trimmed, "```")
		trimmed = strings.TrimSpace(trimmed)
	}
	return trimmed
}

func extractJSONObject(text string) string {
	trimmed := trimJSONFence(text)
	start := strings.Index(trimmed, "{")
	end := strings.LastIndex(trimmed, "}")
	if start >= 0 && end > start {
		return strings.TrimSpace(trimmed[start : end+1])
	}
	return strings.TrimSpace(trimmed)
}

func buildMasterSnapshotPrompt(previousSnapshot map[string]any, events []engramCompactionEvent, now time.Time) string {
	prevJSON := "null"
	if len(previousSnapshot) > 0 {
		if raw, err := json.Marshal(previousSnapshot); err == nil {
			prevJSON = string(raw)
		}
	}
	eventJSON := "[]"
	if raw, err := json.Marshal(events); err == nil {
		eventJSON = string(raw)
	}

	return fmt.Sprintf(`SYSTEM
Eres OzyEngram Core-Processor (Codex Mode). Tu función es actuar como un reductor de estados para un sistema Backend-as-a-Service.

ENTRADA: Un array JSON de eventos de mutación (schema.*, mcp_activity, security_audit).
TAREA: Ejecutar un "State Merge". Debes iterar sobre los eventos cronológicamente para reconstruir el estado físico y semántico actual, eliminando redundancias y ruido.

REGLAS:
1) Causalidad determinista: integra tablas/FKs en estado final.
2) Conserva flags y eventos de seguridad (is_protected, blocked, hard_lock).
3) Deduplica heartbeats/reintentos repetidos.
4) Salida JSON estricta; sin texto fuera del JSON.

USER
EJECUTA COMPACTACIÓN DE MEMORIA:
Contexto previo: %s
Lote de eventos nuevos: %s
Timestamp actual: %s

ESQUEMA DE SALIDA REQUERIDO:
{
  "event_type": "schema.master_snapshot",
  "version": "1.0.1",
  "timestamp": "%s",
  "metadata": {
    "events_compacted": %d,
    "initial_entropy": "HIGH",
    "final_entropy": "0.00 (Perfect Order)"
  },
  "final_state": {
    "tables": {},
    "relationships": [],
    "active_security_policies": []
  },
  "audit_summary": "",
  "context_debt": {
    "missing_logic": [],
    "severity": "nominal"
  }
}
`, prevJSON, eventJSON, now.UTC().Format(time.RFC3339), now.UTC().Format(time.RFC3339), len(events))
}

func (h *Handler) generateMasterSnapshot(ctx context.Context, previousSnapshot map[string]any, events []engramCompactionEvent) (map[string]any, string, error) {
	prompt := buildMasterSnapshotPrompt(previousSnapshot, events, time.Now().UTC())
	apiKey, err := h.loadEngramLLMAPIKey(ctx)
	if err != nil {
		return nil, "fallback", err
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, "fallback", fmt.Errorf("llm api key not configured")
	}

	provider := inferEngramLLMProvider(apiKey)
	var endpoint string
	var reqBody any
	headers := map[string]string{
		"Content-Type": "application/json",
		"Accept":       "application/json",
	}

	switch provider {
	case "gemini":
		endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + url.QueryEscape(strings.TrimSpace(apiKey))
		reqBody = map[string]any{
			"contents": []map[string]any{
				{"parts": []map[string]any{{"text": prompt}}},
			},
		}
	case "openrouter":
		endpoint = "https://openrouter.ai/api/v1/chat/completions"
		headers["Authorization"] = "Bearer " + strings.TrimSpace(apiKey)
		headers["HTTP-Referer"] = "https://ozybase.local"
		headers["X-Title"] = "OzyBase Architect"
		reqBody = map[string]any{
			"model": "anthropic/claude-3.5-sonnet",
			"messages": []map[string]any{
				{"role": "system", "content": "Responde únicamente con JSON válido."},
				{"role": "user", "content": prompt},
			},
			"temperature": 0.1,
		}
	default:
		provider = "openai"
		endpoint = "https://api.openai.com/v1/chat/completions"
		headers["Authorization"] = "Bearer " + strings.TrimSpace(apiKey)
		reqBody = map[string]any{
			"model": "gpt-4o-mini",
			"messages": []map[string]any{
				{"role": "system", "content": "Responde únicamente con JSON válido."},
				{"role": "user", "content": prompt},
			},
			"temperature": 0.1,
		}
	}

	payload, _ := json.Marshal(reqBody)
	req, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if reqErr != nil {
		return nil, provider, reqErr
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if provider == "gemini" {
		req.Header.Set("x-goog-api-key", strings.TrimSpace(apiKey))
	}

	client := &http.Client{Timeout: 20 * time.Second}
	res, callErr := client.Do(req)
	if callErr != nil {
		return nil, provider, callErr
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, provider, fmt.Errorf("llm status %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	var raw map[string]any
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&raw); err != nil {
		return nil, provider, err
	}

	var text string
	if provider == "gemini" {
		if candidates, ok := raw["candidates"].([]any); ok && len(candidates) > 0 {
			if c0, ok := candidates[0].(map[string]any); ok {
				if content, ok := c0["content"].(map[string]any); ok {
					if parts, ok := content["parts"].([]any); ok && len(parts) > 0 {
						if p0, ok := parts[0].(map[string]any); ok {
							text = strings.TrimSpace(fmt.Sprintf("%v", p0["text"]))
						}
					}
				}
			}
		}
	} else if choices, ok := raw["choices"].([]any); ok && len(choices) > 0 {
		if c0, ok := choices[0].(map[string]any); ok {
			if msg, ok := c0["message"].(map[string]any); ok {
				text = strings.TrimSpace(fmt.Sprintf("%v", msg["content"]))
			}
		}
	}
	if strings.TrimSpace(text) == "" {
		return nil, provider, fmt.Errorf("empty llm response")
	}

	jsonText := extractJSONObject(text)
	var snapshot map[string]any
	if err := json.Unmarshal([]byte(jsonText), &snapshot); err != nil {
		return nil, provider, err
	}
	return snapshot, provider, nil
}

type engramCompactionResult struct {
	Executed         bool   `json:"executed"`
	Compacted        bool   `json:"compacted"`
	Reason           string `json:"reason,omitempty"`
	Trigger          string `json:"trigger"`
	Threshold        int    `json:"threshold"`
	UncompactedCount int    `json:"uncompacted_count"`
	EventsCompacted  int    `json:"events_compacted"`
	Provider         string `json:"provider,omitempty"`
	BatchID          string `json:"batch_id,omitempty"`
	Forced           bool   `json:"forced"`
}

func (h *Handler) runSemanticCompaction(ctx context.Context, trigger string, forceLLM bool) (engramCompactionResult, error) {
	result := engramCompactionResult{
		Executed:  true,
		Compacted: false,
		Trigger:   trigger,
		Threshold: engramAutoCompactionThreshold,
		Forced:    forceLLM,
	}

	if err := h.ensureMCPApprovalsSchema(ctx); err != nil {
		result.Reason = "schema_unavailable"
		return result, err
	}

	apiKey, err := h.loadEngramLLMAPIKey(ctx)
	if err != nil {
		result.Reason = "api_key_load_failed"
		return result, err
	}
	if strings.TrimSpace(apiKey) == "" {
		result.Reason = "missing_api_key"
		return result, nil
	}

	var uncompactedCount int
	if err := h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM _v_project_engram
		WHERE COALESCE(is_compacted, false) = false
		  AND (
			tool LIKE 'schema.%'
			OR tool = 'mcp_activity'
			OR tool = 'security_audit'
		  )
		  AND tool <> 'schema.master_snapshot'
	`).Scan(&uncompactedCount); err != nil {
		result.Reason = "count_failed"
		return result, err
	}
	result.UncompactedCount = uncompactedCount
	if !forceLLM && uncompactedCount < engramAutoCompactionThreshold {
		result.Reason = "below_threshold"
		return result, nil
	}

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT id, tool, COALESCE(operation_detail,''), COALESCE(target_resource,''), COALESCE(result,''), COALESCE(status_msg,''), created_at, COALESCE(tool_arguments, '{}'::jsonb)
		FROM _v_project_engram
		WHERE COALESCE(is_compacted, false) = false
		  AND (
			tool LIKE 'schema.%'
			OR tool = 'mcp_activity'
			OR tool = 'security_audit'
		  )
		  AND tool <> 'schema.master_snapshot'
		ORDER BY created_at ASC
		LIMIT $1
	`, engramAutoCompactionBatchMax)
	if err != nil {
		result.Reason = "load_batch_failed"
		return result, err
	}
	defer rows.Close()

	events := make([]engramCompactionEvent, 0, engramAutoCompactionBatchMax)
	eventIDs := make([]int64, 0, engramAutoCompactionBatchMax)
	for rows.Next() {
		var (
			rec    engramCompactionEvent
			argRaw []byte
		)
		if scanErr := rows.Scan(&rec.ID, &rec.Tool, &rec.Operation, &rec.TargetResource, &rec.Result, &rec.StatusMsg, &rec.CreatedAt, &argRaw); scanErr != nil {
			continue
		}
		_ = json.Unmarshal(argRaw, &rec.Arguments)
		eventIDs = append(eventIDs, rec.ID)
		events = append(events, rec)
	}
	if len(events) == 0 {
		result.Reason = "nothing_to_compact"
		return result, nil
	}

	previousSnapshot := map[string]any{}
	var previousRaw []byte
	if err := h.DB.Pool.QueryRow(ctx, `
		SELECT COALESCE(tool_arguments, '{}'::jsonb)
		FROM _v_project_engram
		WHERE tool = 'schema.master_snapshot'
		ORDER BY created_at DESC
		LIMIT 1
	`).Scan(&previousRaw); err == nil {
		_ = json.Unmarshal(previousRaw, &previousSnapshot)
	}

	snapshot, providerUsed, err := h.generateMasterSnapshot(ctx, previousSnapshot, events)
	if err != nil {
		result.Reason = "llm_distillation_failed"
		result.Provider = providerUsed
		return result, err
	}
	now := time.Now().UTC()
	batchID := fmt.Sprintf("cmp-%d", now.UnixNano())
	snapshot["trigger"] = trigger
	snapshot["provider"] = providerUsed
	snapshot["batch_id"] = batchID

	if appendErr := h.appendProjectEngram(ctx, mcpStreamEvent{
		AgentTokenID:    "",
		AgentName:       "OzyEngram",
		Tool:            "schema.master_snapshot",
		OperationDetail: "MASTER SNAPSHOT COMPACTION",
		TargetResource:  "system",
		ActivityKind:    mcpActivityKindSystem,
		PipelineFX:      mcpPipelineFXFlow,
		SecurityLevel:   mcpSecurityLevelMedio,
		ToolRisk:        mcpToolRiskRead,
		Result:          "captured",
		StatusMsg:       fmt.Sprintf("Compacción automática aplicada sobre %d eventos.", len(eventIDs)),
		LatencyMS:       0,
		Timestamp:       now,
	}, snapshot); appendErr != nil {
		result.Reason = "store_master_snapshot_failed"
		result.Provider = providerUsed
		return result, appendErr
	}

	if _, err := h.DB.Pool.Exec(ctx, `
		UPDATE _v_project_engram
		SET is_compacted = true,
			compacted_at = $1,
			compaction_batch_id = $2
		WHERE id = ANY($3)
	`, now, batchID, eventIDs); err != nil {
		result.Reason = "mark_compacted_failed"
		result.Provider = providerUsed
		return result, err
	}

	result.Compacted = true
	result.Reason = "ok"
	result.Provider = providerUsed
	result.BatchID = batchID
	result.EventsCompacted = len(eventIDs)
	return result, nil
}

func (h *Handler) maybeRunSemanticCompaction(trigger string) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	_, _ = h.runSemanticCompaction(ctx, trigger, false)
}

func (h *Handler) runSemanticAutodocWorker(agentTokenID, agentName, level, risk, sourceTool string, targets []string) {
	for _, table := range targets {
		table = strings.ToLower(strings.TrimSpace(table))
		if table == "" || table == "system" {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)

		columnRows, err := h.DB.Pool.Query(ctx, `
			SELECT column_name, data_type
			FROM information_schema.columns
			WHERE table_schema='public' AND table_name=$1
			ORDER BY ordinal_position
		`, table)
		if err != nil {
			cancel()
			continue
		}
		columns := make([]string, 0, 16)
		for columnRows.Next() {
			var name, dtype string
			if scanErr := columnRows.Scan(&name, &dtype); scanErr == nil {
				columns = append(columns, strings.ToLower(name)+":"+strings.ToLower(dtype))
			}
		}
		columnRows.Close()

		fkRows, fkErr := h.DB.Pool.Query(ctx, `
			SELECT kcu.column_name, ccu.table_name, ccu.column_name
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu
			  ON tc.constraint_name = kcu.constraint_name
			 AND tc.table_schema = kcu.table_schema
			JOIN information_schema.constraint_column_usage ccu
			  ON ccu.constraint_name = tc.constraint_name
			 AND ccu.table_schema = tc.table_schema
			WHERE tc.constraint_type='FOREIGN KEY'
			  AND tc.table_schema='public'
			  AND tc.table_name=$1
		`, table)
		relations := make([]string, 0, 8)
		if fkErr == nil {
			for fkRows.Next() {
				var col, refTable, refCol string
				if scanErr := fkRows.Scan(&col, &refTable, &refCol); scanErr == nil {
					relations = append(relations, strings.ToLower(col)+"->"+strings.ToLower(refTable)+"."+strings.ToLower(refCol))
				}
			}
			fkRows.Close()
		}

		desc, providerUsed := h.generateSemanticDescription(ctx, table, columns, relations)
		payload := map[string]any{
			"source_tool":  sourceTool,
			"table":        table,
			"columns":      columns,
			"relations":    relations,
			"description":  desc,
			"llm_provider": providerUsed,
			"worker_mode":  "auto_healing",
		}
		_ = h.appendProjectEngram(ctx, mcpStreamEvent{
			AgentTokenID:    agentTokenID,
			AgentName:       agentName,
			Tool:            "schema.semantic_autodoc",
			OperationDetail: "SEMANTIC AUTODOC",
			TargetResource:  table,
			ActivityKind:    mcpActivityKindSystem,
			PipelineFX:      mcpPipelineFXFlow,
			SecurityLevel:   level,
			ToolRisk:        risk,
			Result:          "captured",
			StatusMsg:       "Auto-sanación semántica: snapshot y descripción generados automáticamente.",
			LatencyMS:       0,
			Timestamp:       time.Now().UTC(),
		}, payload)
		cancel()
	}
	h.maybeRunSemanticCompaction("autodoc")
}

func buildMCPEventSummaryMarkdown(event mcpStreamEvent) string {
	op := strings.TrimSpace(event.OperationDetail)
	if op == "" {
		op = "OPERATION"
	}
	resource := strings.TrimSpace(event.TargetResource)
	if resource == "" {
		resource = "system"
	}
	agent := strings.TrimSpace(event.AgentName)
	if agent == "" {
		agent = "MCP Agent"
	}
	kind := strings.ToLower(strings.TrimSpace(event.ActivityKind))
	action := "observed"
	switch kind {
	case "write":
		action = "applied"
	case "read":
		action = "inspected"
	case "auth":
		action = "authorized"
	case "system":
		action = "updated"
	}

	line := fmt.Sprintf("**%s** %s `%s` by %s.", op, action, resource, agent)
	if status := strings.TrimSpace(event.StatusMsg); status != "" {
		line = line + " _" + status + "_"
	}
	return line
}

func (h *Handler) appendProjectEngram(ctx context.Context, event mcpStreamEvent, toolArgs map[string]any) error {
	argsJSON, err := json.Marshal(toolArgs)
	if err != nil {
		argsJSON = []byte("{}")
	}

	summaryMD := buildMCPEventSummaryMarkdown(event)
	causalRef := deriveMCPEventCausalRef(toolArgs)

	_, err = h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_project_engram (
			agent_token_id,
			agent_name,
			tool,
			operation_detail,
			target_resource,
			activity_kind,
			pipeline_fx,
			security_level,
			tool_risk,
			result,
			status_msg,
			latency_ms,
			summary_md,
			tool_arguments,
			causal_ref,
			created_at
		)
		VALUES (
			CASE
				WHEN NULLIF($1, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
				THEN NULLIF($1, '')::uuid
				ELSE NULL
			END,
			$2,
			$3,
			$4,
			$5,
			$6,
			$7,
			$8,
			$9,
			$10,
			$11,
			$12,
			$13,
			$14::jsonb,
			NULLIF($15, '')::uuid,
			$16
		)
	`,
		strings.TrimSpace(event.AgentTokenID),
		strings.TrimSpace(event.AgentName),
		strings.TrimSpace(event.Tool),
		strings.TrimSpace(event.OperationDetail),
		strings.TrimSpace(event.TargetResource),
		strings.TrimSpace(event.ActivityKind),
		strings.TrimSpace(event.PipelineFX),
		strings.TrimSpace(event.SecurityLevel),
		strings.TrimSpace(event.ToolRisk),
		strings.TrimSpace(event.Result),
		strings.TrimSpace(event.StatusMsg),
		event.LatencyMS,
		summaryMD,
		string(argsJSON),
		causalRef,
		event.Timestamp,
	)
	if err == nil {
		return nil
	}

	// Backward-compatible fallback for older Engram schemas that do not have
	// summary_md / causal_ref columns yet.
	if isMissingMCPSchemaError(err) {
		_, fallbackErr := h.DB.Pool.Exec(ctx, `
			INSERT INTO _v_project_engram (
				agent_token_id,
				agent_name,
				tool,
				operation_detail,
				target_resource,
				activity_kind,
				pipeline_fx,
				security_level,
				tool_risk,
				result,
				status_msg,
				latency_ms,
				tool_arguments,
				created_at
			)
			VALUES (
				CASE
					WHEN NULLIF($1, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
					THEN NULLIF($1, '')::uuid
					ELSE NULL
				END,
				$2,
				$3,
				$4,
				$5,
				$6,
				$7,
				$8,
				$9,
				$10,
				$11,
				$12,
				$13::jsonb,
				$14
			)
		`,
			strings.TrimSpace(event.AgentTokenID),
			strings.TrimSpace(event.AgentName),
			strings.TrimSpace(event.Tool),
			strings.TrimSpace(event.OperationDetail),
			strings.TrimSpace(event.TargetResource),
			strings.TrimSpace(event.ActivityKind),
			strings.TrimSpace(event.PipelineFX),
			strings.TrimSpace(event.SecurityLevel),
			strings.TrimSpace(event.ToolRisk),
			strings.TrimSpace(event.Result),
			strings.TrimSpace(event.StatusMsg),
			event.LatencyMS,
			string(argsJSON),
			event.Timestamp,
		)
		if fallbackErr == nil || isMissingMCPSchemaError(fallbackErr) {
			return nil
		}
		return fallbackErr
	}
	return err
}

func (h *Handler) mcpProjectAwareness(ctx context.Context, args map[string]any) (map[string]any, error) {
	limit := mcpIntArg(args, "limit")
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	windowHours := mcpIntArg(args, "window_hours")
	if windowHours <= 0 {
		windowHours = 24
	}
	if windowHours > 168 {
		windowHours = 168
	}

	resourceFilter := strings.TrimSpace(mcpStringArg(args, "resource"))
	var total int64
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM _v_project_engram
		WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
		  AND COALESCE(is_compacted, false) = false
		  AND ($2 = '' OR target_resource ILIKE ('%' || $2 || '%'))
	`, windowHours, resourceFilter).Scan(&total)
	if err != nil {
		if isMissingMCPSchemaError(err) {
			globalMCPStreamBroker.Publish(mcpStreamEvent{
				EventType:       "engram_update",
				Event:           "engram_update",
				Tool:            "get_project_awareness",
				Result:          "unavailable",
				StatusMsg:       "Shared memory no esta inicializada aun.",
				ActivityKind:    mcpActivityKindSystem,
				PipelineFX:      mcpPipelineFXFlow,
				OperationDetail: "PROJECT AWARENESS",
				TargetResource:  "system",
				EngramStatus:    "unavailable",
				EngramWindow:    windowHours,
				EngramResource:  resourceFilter,
				Timestamp:       time.Now().UTC(),
			})
			return map[string]any{
				"status": "unavailable",
				"reason": "engram store not initialized",
			}, nil
		}
		return nil, err
	}

	type bucket struct {
		Name  string `json:"name"`
		Count int64  `json:"count"`
	}

	readBuckets := func(query string, args ...any) ([]bucket, error) {
		rows, qErr := h.DB.Pool.Query(ctx, query, args...)
		if qErr != nil {
			return nil, qErr
		}
		defer rows.Close()

		out := make([]bucket, 0, 8)
		for rows.Next() {
			var item bucket
			if scanErr := rows.Scan(&item.Name, &item.Count); scanErr != nil {
				continue
			}
			out = append(out, item)
		}
		return out, nil
	}

	topOperations, err := readBuckets(`
		SELECT COALESCE(operation_detail, 'UNKNOWN') AS name, COUNT(*) AS count
		FROM _v_project_engram
		WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
		  AND COALESCE(is_compacted, false) = false
		  AND ($2 = '' OR target_resource ILIKE ('%' || $2 || '%'))
		GROUP BY 1
		ORDER BY 2 DESC, 1 ASC
		LIMIT 5
	`, windowHours, resourceFilter)
	if err != nil {
		return nil, err
	}

	topResources, err := readBuckets(`
		SELECT COALESCE(target_resource, 'system') AS name, COUNT(*) AS count
		FROM _v_project_engram
		WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
		  AND COALESCE(is_compacted, false) = false
		  AND ($2 = '' OR target_resource ILIKE ('%' || $2 || '%'))
		GROUP BY 1
		ORDER BY 2 DESC, 1 ASC
		LIMIT 5
	`, windowHours, resourceFilter)
	if err != nil {
		return nil, err
	}

	recentRows, err := h.DB.Pool.Query(ctx, `
		SELECT
			created_at,
			COALESCE(agent_name, 'MCP Agent') AS agent_name,
			COALESCE(operation_detail, 'OPERATION') AS operation_detail,
			COALESCE(target_resource, 'system') AS target_resource,
			COALESCE(result, '') AS result,
			COALESCE(activity_kind, 'system') AS activity_kind,
			COALESCE(pipeline_fx, 'flow') AS pipeline_fx,
			COALESCE(to_jsonb(_v_project_engram)->>'summary_md', '') AS summary_md,
			COALESCE(to_jsonb(_v_project_engram)->>'causal_ref', '') AS causal_ref
		FROM _v_project_engram
		WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
		  AND COALESCE(is_compacted, false) = false
		  AND ($2 = '' OR target_resource ILIKE ('%' || $2 || '%'))
		ORDER BY created_at DESC
		LIMIT $3
	`, windowHours, resourceFilter, limit)
	if err != nil {
		return nil, err
	}
	defer recentRows.Close()

	recent := make([]map[string]any, 0, limit)
	for recentRows.Next() {
		var createdAt time.Time
		var agentName, operationDetail, targetResource, resultText, activityKind, pipelineFX, summaryMD, causalRef string
		if scanErr := recentRows.Scan(&createdAt, &agentName, &operationDetail, &targetResource, &resultText, &activityKind, &pipelineFX, &summaryMD, &causalRef); scanErr != nil {
			continue
		}
		recent = append(recent, map[string]any{
			"created_at":       createdAt,
			"agent_name":       agentName,
			"operation_detail": operationDetail,
			"target_resource":  targetResource,
			"result":           resultText,
			"activity_kind":    activityKind,
			"pipeline_fx":      pipelineFX,
			"summary_md":       summaryMD,
			"causal_ref":       causalRef,
		})
	}

	entropyRows, err := h.DB.Pool.Query(ctx, `
		SELECT
			COALESCE(operation_detail, 'OPERATION') AS operation_detail,
			COALESCE(target_resource, 'system') AS target_resource,
			COALESCE(agent_name, 'MCP Agent') AS agent_name,
			COALESCE(activity_kind, 'system') AS activity_kind,
			COALESCE(to_jsonb(_v_project_engram)->>'causal_ref', '') AS causal_ref
		FROM _v_project_engram
		WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
		  AND COALESCE(is_compacted, false) = false
		  AND ($2 = '' OR target_resource ILIKE ('%' || $2 || '%'))
		ORDER BY created_at DESC
		LIMIT 20
	`, windowHours, resourceFilter)
	if err != nil {
		return nil, err
	}
	defer entropyRows.Close()

	entropySample := make([]map[string]any, 0, 20)
	for entropyRows.Next() {
		var operationDetail, targetResource, agentName, activityKind, causalRef string
		if scanErr := entropyRows.Scan(&operationDetail, &targetResource, &agentName, &activityKind, &causalRef); scanErr != nil {
			continue
		}
		entropySample = append(entropySample, map[string]any{
			"operation_detail": operationDetail,
			"target_resource":  targetResource,
			"agent_name":       agentName,
			"activity_kind":    activityKind,
			"causal_ref":       causalRef,
		})
	}

	entropy := buildEngramEntropyStats(entropySample)
	semanticStatus, semanticPhysical, semanticSnapshots, semanticMissing, semanticPhysicalNames, semanticSnapshotNames, semanticRecentAlert, semanticLastAlertAt, semanticErr := h.computeSemanticHealth(ctx, time.Now().UTC())
	if semanticErr != nil {
		logger.Log.Warn().Err(semanticErr).Str("module", "mcp_awareness").Msg("failed to compute semantic health")
		semanticStatus = "unknown"
	}
	semanticCompactionPending := int64(0)
	if pendingCount, pendingErr := h.countSemanticCompactionPending(ctx); pendingErr != nil {
		logger.Log.Warn().Err(pendingErr).Str("module", "mcp_awareness").Msg("failed to compute semantic compaction queue")
	} else {
		semanticCompactionPending = pendingCount
	}

	awareness := map[string]any{
		"status":             "ok",
		"window_hours":       windowHours,
		"resource_filter":    resourceFilter,
		"total_events":       total,
		"top_operations":     topOperations,
		"top_resources":      topResources,
		"recent_events":      recent,
		"chronicle_markdown": buildEngramChronicleMarkdown(windowHours, total, recent),
		"entropy_score":      entropy.Score,
		"entropy_state":      entropy.State,
		"entropy_color":      entropy.Color,
		"entropy_factors": map[string]any{
			"mutation_density":     entropy.MutationDensity,
			"structural_fragility": entropy.StructuralFragility,
			"agent_dissonance":     entropy.AgentDissonance,
		},
		"context_budget": map[string]any{
			"ratio":  entropy.ContextBudgetRatio,
			"tokens": entropy.ContextBudgetTokens,
		},
		"memory_layers": map[string]any{
			"hot_limit":   limit,
			"cold_mode":   "summary",
			"audit_store": "_v_project_engram",
		},
		"semantic_health": map[string]any{
			"status":                        semanticStatus,
			"physical_tables":               semanticPhysical,
			"semantic_snapshot_tables":      semanticSnapshots,
			"compaction_pending":            semanticCompactionPending,
			"missing_tables":                semanticMissing,
			"physical_table_names":          semanticPhysicalNames,
			"semantic_snapshot_table_names": semanticSnapshotNames,
			"recent_security_alert":         semanticRecentAlert,
			"last_security_alert_at":        semanticLastAlertAt,
		},
	}

	targetResource := resourceFilter
	if strings.TrimSpace(targetResource) == "" {
		targetResource = "system"
	}

	globalMCPStreamBroker.Publish(mcpStreamEvent{
		EventType:             "engram_update",
		Event:                 "engram_update",
		Tool:                  "get_project_awareness",
		Result:                "ok",
		StatusMsg:             "Contexto del proyecto sincronizado desde Engram.",
		ActivityKind:          mcpActivityKindSystem,
		PipelineFX:            mcpPipelineFXFlow,
		OperationDetail:       "PROJECT AWARENESS",
		TargetResource:        targetResource,
		EngramStatus:          "ok",
		EngramTotal:           total,
		EngramWindow:          windowHours,
		EngramResource:        resourceFilter,
		EngramRecent:          recent,
		EngramEntropy:         entropy.Score,
		EngramMood:            entropy.State,
		SemanticHealth:        semanticStatus,
		SemanticPhysical:      semanticPhysical,
		SemanticSnapshot:      semanticSnapshots,
		SemanticMissing:       semanticMissing,
		SemanticPhysicalNames: semanticPhysicalNames,
		SemanticSnapshotNames: semanticSnapshotNames,
		SemanticAlert:         semanticRecentAlert,
		Timestamp:             time.Now().UTC(),
	})

	return awareness, nil
}

func (h *Handler) computeSemanticHealth(ctx context.Context, now time.Time) (status string, physicalTables int64, semanticSnapshots int64, missingTables []string, physicalTableNames []string, semanticSnapshotTableNames []string, recentSecurityAlert bool, lastSecurityAlertAt any, err error) {
	status = "unknown"
	err = h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM information_schema.tables
		WHERE table_schema = 'public'
		  AND table_type = 'BASE TABLE'
		  AND table_name NOT LIKE '\_v\_%' ESCAPE '\'
		  AND table_name <> 'schema_migrations'
	`).Scan(&physicalTables)
	if err != nil {
		return status, physicalTables, semanticSnapshots, nil, nil, nil, false, nil, err
	}

	physicalRows, err := h.DB.Pool.Query(ctx, `
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = 'public'
		  AND table_type = 'BASE TABLE'
		  AND table_name NOT LIKE '\_v\_%' ESCAPE '\'
		  AND table_name <> 'schema_migrations'
		ORDER BY table_name ASC
	`)
	if err != nil {
		return status, physicalTables, semanticSnapshots, nil, nil, nil, false, nil, err
	}
	defer physicalRows.Close()
	for physicalRows.Next() {
		var tableName string
		if scanErr := physicalRows.Scan(&tableName); scanErr != nil {
			continue
		}
		tableName = strings.TrimSpace(tableName)
		if tableName == "" {
			continue
		}
		physicalTableNames = append(physicalTableNames, tableName)
	}

	err = h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT target_resource)
		FROM _v_project_engram
		WHERE tool IN ('schema.semantic_snapshot', 'schema.semantic_autodoc')
		  AND COALESCE(target_resource, '') <> ''
		  AND target_resource <> 'system'
		  AND target_resource NOT LIKE '\_v\_%' ESCAPE '\'
	`).Scan(&semanticSnapshots)
	if err != nil {
		return status, physicalTables, semanticSnapshots, nil, physicalTableNames, nil, false, nil, err
	}

	snapshotRows, err := h.DB.Pool.Query(ctx, `
		SELECT DISTINCT target_resource
		FROM _v_project_engram
		WHERE tool IN ('schema.semantic_snapshot', 'schema.semantic_autodoc')
		  AND COALESCE(target_resource, '') <> ''
		  AND target_resource <> 'system'
		  AND target_resource NOT LIKE '\_v\_%' ESCAPE '\'
		ORDER BY target_resource ASC
	`)
	if err != nil {
		return status, physicalTables, semanticSnapshots, nil, physicalTableNames, nil, false, nil, err
	}
	defer snapshotRows.Close()
	snapshotSet := map[string]struct{}{}
	for snapshotRows.Next() {
		var tableName string
		if scanErr := snapshotRows.Scan(&tableName); scanErr != nil {
			continue
		}
		tableName = strings.TrimSpace(tableName)
		if tableName == "" {
			continue
		}
		snapshotSet[tableName] = struct{}{}
		semanticSnapshotTableNames = append(semanticSnapshotTableNames, tableName)
	}
	for _, tableName := range physicalTableNames {
		if _, ok := snapshotSet[tableName]; !ok {
			missingTables = append(missingTables, tableName)
		}
	}

	recentSecurityAlert, lastAlert := hasRecentMCPSecurityAlert(30*time.Second, now)
	if !lastAlert.IsZero() {
		lastSecurityAlertAt = lastAlert
	}

	switch {
	case recentSecurityAlert:
		status = "alert"
	case physicalTables == semanticSnapshots:
		status = "synchronized"
	default:
		status = "drift"
	}

	return status, physicalTables, semanticSnapshots, missingTables, physicalTableNames, semanticSnapshotTableNames, recentSecurityAlert, lastSecurityAlertAt, nil
}

func (h *Handler) countSemanticCompactionPending(ctx context.Context) (int64, error) {
	var pending int64
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM _v_project_engram
		WHERE COALESCE(is_compacted, false) = false
		  AND (
			tool LIKE 'schema.%'
			OR tool = 'mcp_activity'
			OR tool = 'security_audit'
		  )
		  AND tool <> 'schema.master_snapshot'
	`).Scan(&pending)
	if err != nil {
		return 0, err
	}
	return pending, nil
}

func buildEngramEntropyStats(recent []map[string]any) engramEntropyStats {
	const (
		maxContextTokens = 12000
	)

	stats := engramEntropyStats{
		Score:               0,
		State:               "flow",
		Color:               "green",
		MutationDensity:     0,
		StructuralFragility: 0,
		AgentDissonance:     0,
		ContextBudgetRatio:  1,
		ContextBudgetTokens: maxContextTokens,
	}

	total := len(recent)
	if total == 0 {
		return stats
	}

	isMutation := func(op, kind string) bool {
		if strings.EqualFold(strings.TrimSpace(kind), "write") {
			return true
		}
		normalized := strings.ToLower(strings.TrimSpace(op))
		return strings.Contains(normalized, "create") || strings.Contains(normalized, "alter") || strings.Contains(normalized, "drop") || strings.Contains(normalized, "rename") || strings.Contains(normalized, "update") || strings.Contains(normalized, "delete")
	}

	mutationCount := 0
	structuralOps := 0
	targetMutationCounts := map[string]int{}
	latestByTarget := map[string]map[string]any{}
	dissonanceHits := 0

	for _, row := range recent {
		op := strings.TrimSpace(fmt.Sprintf("%v", row["operation_detail"]))
		kind := strings.TrimSpace(fmt.Sprintf("%v", row["activity_kind"]))
		target := strings.TrimSpace(fmt.Sprintf("%v", row["target_resource"]))
		agent := strings.TrimSpace(fmt.Sprintf("%v", row["agent_name"]))
		causalRef := strings.TrimSpace(fmt.Sprintf("%v", row["causal_ref"]))
		if target == "" {
			target = "system"
		}

		if isMutation(op, kind) {
			mutationCount++
			targetMutationCounts[target]++
		}

		normalizedOp := strings.ToLower(op)
		if strings.Contains(normalizedOp, "create") || strings.Contains(normalizedOp, "alter") || strings.Contains(normalizedOp, "drop") || strings.Contains(normalizedOp, "rename") {
			structuralOps++
		}

		if causalRef != "" && causalRef != "<nil>" {
			if prev, ok := latestByTarget[target]; ok {
				prevAgent := strings.TrimSpace(fmt.Sprintf("%v", prev["agent_name"]))
				if prevAgent != "" && agent != "" && !strings.EqualFold(prevAgent, agent) {
					dissonanceHits++
				}
			}
		}

		latestByTarget[target] = map[string]any{
			"agent_name": agent,
		}
	}

	maxMutationsOnSingleTarget := 0
	for _, count := range targetMutationCounts {
		if count > maxMutationsOnSingleTarget {
			maxMutationsOnSingleTarget = count
		}
	}

	mutationDensity := float64(mutationCount) / float64(total)
	hotspotPenalty := 0.0
	if mutationCount > 0 {
		hotspotPenalty = float64(maxMutationsOnSingleTarget) / float64(mutationCount)
	}
	structuralFragility := float64(structuralOps) / float64(total)
	agentDissonance := float64(dissonanceHits) / float64(total)

	score := (0.45 * mutationDensity) + (0.2 * hotspotPenalty) + (0.2 * structuralFragility) + (0.15 * agentDissonance)
	score = math.Max(0, math.Min(1, score))

	state := "flow"
	color := "green"
	budgetRatio := 1.0
	switch {
	case score < 0.3:
		state = "flow"
		color = "green"
		budgetRatio = 1
	case score < 0.6:
		state = "tension"
		color = "amber"
		budgetRatio = 0.75
	case score <= 0.8:
		state = "chaos"
		color = "red"
		budgetRatio = 0.45
	default:
		state = "debt"
		color = "blue"
		budgetRatio = 0.35
	}

	stats.Score = score
	stats.State = state
	stats.Color = color
	stats.MutationDensity = mutationDensity
	stats.StructuralFragility = structuralFragility
	stats.AgentDissonance = agentDissonance
	stats.ContextBudgetRatio = budgetRatio
	stats.ContextBudgetTokens = int(math.Round(float64(maxContextTokens) * budgetRatio))
	return stats
}

func buildEngramChronicleMarkdown(windowHours int, total int64, recent []map[string]any) string {
	var b strings.Builder
	b.WriteString("### 🧠 Project Awareness: OzyBase\n")
	b.WriteString("**Status:** Stable | **Window:** ")
	b.WriteString(strconv.Itoa(windowHours))
	b.WriteString("h | **Events:** ")
	b.WriteString(strconv.FormatInt(total, 10))
	b.WriteString("\n\n")
	b.WriteString("#### 🏗️ Schema Changes\n")

	maxLines := 12
	schemaCount := 0
	logicCount := 0
	for _, item := range recent {
		if maxLines <= 0 {
			break
		}
		op := strings.TrimSpace(fmt.Sprintf("%v", item["operation_detail"]))
		if op == "" {
			op = "OPERATION"
		}
		resource := strings.TrimSpace(fmt.Sprintf("%v", item["target_resource"]))
		if resource == "" {
			resource = "system"
		}
		agent := strings.TrimSpace(fmt.Sprintf("%v", item["agent_name"]))
		if agent == "" {
			agent = "MCP Agent"
		}
		kind := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", item["activity_kind"])))
		summary := strings.TrimSpace(fmt.Sprintf("%v", item["summary_md"]))
		if summary == "<nil>" {
			summary = ""
		}

		line := "- **" + op + "** sobre `" + resource + "` por " + agent + ".\n"
		if summary != "" {
			line = "- " + strings.Split(summary, "\n")[0] + "\n"
		}
		if kind == "write" || strings.Contains(strings.ToLower(op), "create") || strings.Contains(strings.ToLower(op), "alter") {
			b.WriteString(line)
			schemaCount++
			maxLines--
		}
	}
	if schemaCount == 0 {
		b.WriteString("- Sin cambios de esquema recientes.\n")
	}

	b.WriteString("\n#### ⚡ Logic & Functions\n")
	for _, item := range recent {
		if maxLines <= 0 {
			break
		}
		op := strings.TrimSpace(fmt.Sprintf("%v", item["operation_detail"]))
		if op == "" {
			op = "OPERATION"
		}
		resource := strings.TrimSpace(fmt.Sprintf("%v", item["target_resource"]))
		if resource == "" {
			resource = "system"
		}
		agent := strings.TrimSpace(fmt.Sprintf("%v", item["agent_name"]))
		if agent == "" {
			agent = "MCP Agent"
		}
		kind := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", item["activity_kind"])))
		summary := strings.TrimSpace(fmt.Sprintf("%v", item["summary_md"]))
		if summary == "<nil>" {
			summary = ""
		}

		if kind == "write" || kind == "read" || kind == "system" {
			if summary != "" {
				b.WriteString("- " + strings.Split(summary, "\n")[0] + "\n")
			} else {
				b.WriteString("- **" + op + "** en `" + resource + "` por " + agent + ".\n")
			}
			logicCount++
			maxLines--
		}
	}
	if logicCount == 0 {
		b.WriteString("- Sin cambios de logica recientes.\n")
	}

	b.WriteString("\n#### 🔗 Causal Chain\n")
	causalCount := 0
	for _, item := range recent {
		if causalCount >= 6 {
			break
		}
		causalRef := strings.TrimSpace(fmt.Sprintf("%v", item["causal_ref"]))
		if causalRef == "" || causalRef == "<nil>" {
			continue
		}
		op := strings.TrimSpace(fmt.Sprintf("%v", item["operation_detail"]))
		if op == "" {
			op = "OPERATION"
		}
		b.WriteString("- **" + op + "** ← `" + causalRef + "`\n")
		causalCount++
	}
	if causalCount == 0 {
		b.WriteString("- Sin referencias causales recientes.\n")
	}

	return b.String()
}

func mcpStreamSigningKey() string {
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if secret == "" {
		return "mcp-stream-fallback-signing-key"
	}
	return secret
}

// CreateMCPStreamSession handles POST /api/project/mcp/stream/session
func (h *Handler) CreateMCPStreamSession(c echo.Context) error {
	userID := strings.TrimSpace(userIDFromContext(c))
	role := strings.ToLower(strings.TrimSpace(roleFromContext(c)))
	if userID == "" && c.Get("is_service_role") != true {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}

	now := time.Now().UTC()
	expiresAt := now.Add(5 * time.Minute)
	claims := mcpStreamSessionClaims{
		Scope:  "mcp-stream",
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			Subject:   userID,
		},
	}
	if claims.Subject == "" {
		claims.Subject = role
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(mcpStreamSigningKey()))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to sign stream session"})
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"token":      tokenString,
		"expires_at": expiresAt,
	})
}

func parseMCPStreamToken(raw string) (mcpStreamSessionClaims, error) {
	claims := mcpStreamSessionClaims{}
	token, err := jwt.ParseWithClaims(raw, &claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(mcpStreamSigningKey()), nil
	})
	if err != nil {
		return claims, err
	}
	if !token.Valid {
		return claims, fmt.Errorf("invalid mcp stream token")
	}
	if claims.Scope != "mcp-stream" {
		return claims, fmt.Errorf("invalid stream token scope")
	}
	return claims, nil
}

// StreamMCPEvents handles GET /api/project/mcp/stream
func (h *Handler) StreamMCPEvents(c echo.Context) error {
	rawToken := strings.TrimSpace(c.QueryParam("token"))
	if rawToken == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "mcp stream token is required"})
	}
	if _, err := parseMCPStreamToken(rawToken); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid mcp stream token"})
	}

	w := c.Response()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	eventChan := globalMCPStreamBroker.Subscribe(64)
	defer globalMCPStreamBroker.Unsubscribe(eventChan)

	if _, err := fmt.Fprintf(w, ": mcp stream connected\n\n"); err != nil {
		return nil
	}
	w.Flush()

	snapshotAt := time.Now().UTC()
	for _, session := range h.listRecentMCPLiveSessions(c.Request().Context(), 30*time.Minute) {
		sessionTokenID := strings.TrimSpace(session.TokenID)
		if sessionTokenID == "" {
			continue
		}
		payload, err := json.Marshal(mcpStreamEvent{
			EventType:     "mcp_presence",
			Event:         "mcp_presence",
			AgentTokenID:  sessionTokenID,
			AgentName:     strings.TrimSpace(session.Name),
			SecurityLevel: normalizeMCPSecurityLevel(session.SecurityLevel),
			Result:        strings.TrimSpace(session.Status),
			StatusMsg:     "agent listening",
			Timestamp:     snapshotAt,
		})
		if err != nil {
			continue
		}
		if _, err := fmt.Fprintf(w, "event: mcp_presence\ndata: %s\n\n", payload); err != nil {
			return nil
		}
		w.Flush()
	}

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	ctx := c.Request().Context()
	for {
		select {
		case event := <-eventChan:
			payload, err := json.Marshal(event)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.EventType, payload); err != nil {
				return nil
			}
			w.Flush()
		case <-heartbeat.C:
			heartbeatEvent := mcpStreamEvent{EventType: "heartbeat", Event: "heartbeat", Timestamp: time.Now().UTC()}
			payload, _ := json.Marshal(heartbeatEvent)
			if _, err := fmt.Fprintf(w, "event: heartbeat\ndata: %s\n\n", payload); err != nil {
				return nil
			}
			w.Flush()
		case <-ctx.Done():
			return nil
		}
	}
}

func (h *Handler) enforceMCPGuardrails(ctx context.Context, c echo.Context, tool string, args map[string]any) (mcpGuardrailDecision, string, error) {
	isAPIKey := c.Get("is_api_key") == true
	resolvedTokenID, _, _, _ := resolveMCPAgentIdentity(c)
	level, guardrailSource := h.resolveEffectiveMCPSecurityLevel(ctx, c, resolvedTokenID)

	decision := evaluateMCPGuardrail(level, tool)
	decision.Level = normalizeMCPSecurityLevel(level)
	decision.AutonomyLevel = "detached"
	decision.GuardrailSource = guardrailSource
	decision.Risk = classifyMCPToolRisk(tool)
	if decision.Action == "" {
		decision.Action = mcpGuardrailActionExecute
	}
	if decision.Action == mcpGuardrailActionPending && !isAPIKey {
		decision.Action = mcpGuardrailActionBlocked
		decision.Reason = "PENDING_AUTHORIZATION: Ejecuta esta accion via flujo MCP con API key del agente."
	}

	skillAllowed, skillReason, _, _ := h.mcpSkillAllowsLevel(ctx, tool, decision.Level)
	if !skillAllowed {
		decision.Action = mcpGuardrailActionBlocked
		decision.Reason = skillReason
		return decision, "", errors.New(skillReason)
	}

	operationDetail, targetResource := deriveMCPResourceDetails(tool, args)

	if isDestructiveMCPOperation(tool, operationDetail) {
		protectedTarget, protectErr := h.isMCPProtectedTarget(ctx, targetResource)
		if protectErr != nil {
			return decision, "", protectErr
		}
		if protectedTarget {
			confirmed := mcpBoolArg(args, "confirm_destruction", false)
			challengeToken := strings.TrimSpace(mcpStringArg(args, "challenge_token"))
			if decision.Action == mcpGuardrailActionExecute &&
				confirmed &&
				consumeMCPDestructionChallenge(challengeToken, resolvedTokenID, tool, targetResource) {
				return decision, "", nil
			}

			issuedChallenge := issueMCPDestructionChallenge(resolvedTokenID, tool, targetResource)
			lockMessage := fmt.Sprintf("BLOQUEO DE NODO RAÍZ: La tabla [%s] es vital para la integridad del sistema.", strings.TrimSpace(targetResource))
			c.Set("mcp_hard_lock_required", true)
			c.Set("mcp_hard_lock_token", issuedChallenge)
			c.Set("mcp_blocked_status_msg", lockMessage)
			decision.Action = mcpGuardrailActionBlocked
			decision.Reason = lockMessage
			return decision, "", errors.New(lockMessage)
		}
	}

	switch decision.Action {
	case mcpGuardrailActionExecute:
		return decision, "", nil
	case mcpGuardrailActionBlocked:
		return decision, "", errors.New(decision.Reason)
	case mcpGuardrailActionPending:
		approvalID, err := h.createMCPApproval(ctx, c, tool, args, decision)
		if err != nil {
			return decision, "", err
		}
		return decision, approvalID, nil
	default:
		return decision, "", errors.New("unknown MCP guardrail action")
	}
}

func decodeMCPApprovalArgs(raw string) map[string]any {
	out := map[string]any{}
	if strings.TrimSpace(raw) == "" {
		return out
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return map[string]any{}
	}
	if out == nil {
		return map[string]any{}
	}
	return out
}

func (h *Handler) mcpSkillsForLevel(ctx context.Context, level string) []string {
	items, err := h.mcpSkillStoreSnapshot(ctx)
	if err != nil {
		return []string{}
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if !item.Enabled {
			continue
		}
		out = append(out, item.Name)
	}
	_ = level
	return out
}

func (h *Handler) mcpAvailableToolsForLevel(ctx context.Context, level string) []string {
	tools := buildMCPTools()
	seen := make(map[string]struct{}, len(tools))
	available := make([]string, 0, len(tools))
	for _, tool := range tools {
		toolName := strings.TrimSpace(tool.Name)
		if toolName == "" {
			continue
		}
		if _, exists := seen[toolName]; exists {
			continue
		}
		seen[toolName] = struct{}{}
		decision := evaluateMCPGuardrail(level, toolName)
		if decision.Action == mcpGuardrailActionBlocked {
			continue
		}
		skillAllowed, _, _, _ := h.mcpSkillAllowsLevel(ctx, toolName, level)
		if !skillAllowed {
			continue
		}
		available = append(available, toolName)
	}
	return available
}

// ListPendingMCPApprovals handles GET /api/project/mcp/approvals/pending
func (h *Handler) ListPendingMCPApprovals(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	limit := 50
	if raw := strings.TrimSpace(c.QueryParam("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "limit must be a positive integer"})
		}
		if parsed > 200 {
			parsed = 200
		}
		limit = parsed
	}

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT
			id::text,
			COALESCE(token_id::text, ''),
			token_security_level::text,
			COALESCE(workspace_id::text, ''),
			COALESCE(actor_subject, ''),
			tool,
			arguments::text,
			status,
			COALESCE(reason, ''),
			COALESCE(resolved_note, ''),
			created_at,
			updated_at,
			COALESCE(approved_by::text, ''),
			approved_at,
			COALESCE(rejected_by::text, ''),
			rejected_at
		FROM _v_mcp_approvals
		WHERE status = 'pending'
		ORDER BY created_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		if isMissingMCPSchemaError(err) {
			if schemaErr := h.ensureMCPApprovalsSchema(ctx); schemaErr != nil {
				logger.Log.Warn().Err(schemaErr).Msg("MCP approvals schema missing; auto-heal failed, serving fallback payload")
				return c.JSON(http.StatusOK, h.mcpPendingFallbackPayload(ctx))
			}
			rows, err = h.DB.Pool.Query(ctx, `
				SELECT
					id::text,
					COALESCE(token_id::text, ''),
					token_security_level::text,
					COALESCE(workspace_id::text, ''),
					COALESCE(actor_subject, ''),
					tool,
					arguments::text,
					status,
					COALESCE(reason, ''),
					COALESCE(resolved_note, ''),
					created_at,
					updated_at,
					COALESCE(approved_by::text, ''),
					approved_at,
					COALESCE(rejected_by::text, ''),
					rejected_at
				FROM _v_mcp_approvals
				WHERE status = 'pending'
				ORDER BY created_at ASC
				LIMIT $1
			`, limit)
			if err != nil {
				return c.JSON(http.StatusOK, h.mcpPendingFallbackPayload(ctx))
			}
		} else {
			logger.Log.Warn().Err(err).Msg("MCP approvals query failed; serving fallback payload")
			return c.JSON(http.StatusOK, h.mcpPendingFallbackPayload(ctx))
		}
	}
	defer rows.Close()

	items := make([]mcpApprovalRecord, 0, limit)
	for rows.Next() {
		var (
			item         mcpApprovalRecord
			argsJSONText string
		)
		if err := rows.Scan(
			&item.ID,
			&item.TokenID,
			&item.TokenSecurity,
			&item.WorkspaceID,
			&item.ActorSubject,
			&item.Tool,
			&argsJSONText,
			&item.Status,
			&item.Reason,
			&item.ResolvedNote,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.ApprovedBy,
			&item.ApprovedAt,
			&item.RejectedBy,
			&item.RejectedAt,
		); err != nil {
			logger.Log.Warn().Err(err).Msg("MCP approvals parse failed; serving fallback payload")
			return c.JSON(http.StatusOK, h.mcpPendingFallbackPayload(ctx))
		}
		item.Arguments = decodeMCPApprovalArgs(argsJSONText)
		item.ComputedToolRisk = classifyMCPToolRisk(item.Tool)
		items = append(items, item)
	}

	sessionRows, err := h.DB.Pool.Query(ctx, `
		SELECT
			s.token_id::text,
			s.token_security_level::text,
			s.last_activity_at,
			s.pending_count,
			COALESCE(rt.recent_tools, ARRAY[]::text[])
		FROM (
			SELECT
				token_id,
				token_security_level,
				MAX(created_at) AS last_activity_at,
				COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count
			FROM _v_mcp_approvals
			WHERE token_id IS NOT NULL
			  AND created_at >= NOW() - INTERVAL '5 minutes'
			GROUP BY token_id, token_security_level
		) AS s
		LEFT JOIN LATERAL (
			SELECT ARRAY_AGG(tool ORDER BY last_seen DESC) AS recent_tools
			FROM (
				SELECT tool, MAX(created_at) AS last_seen
				FROM _v_mcp_approvals a2
				WHERE a2.token_id = s.token_id
				  AND a2.created_at >= NOW() - INTERVAL '5 minutes'
				GROUP BY tool
				ORDER BY last_seen DESC
				LIMIT 6
			) AS latest_tools
		) AS rt ON TRUE
		ORDER BY s.last_activity_at DESC
		LIMIT 50
	`)
	if err != nil {
		if isMissingMCPSchemaError(err) {
			logger.Log.Warn().Err(err).Msg("MCP active sessions query unavailable; serving fallback payload")
			return c.JSON(http.StatusOK, h.mcpPendingFallbackPayload(ctx))
		}
		logger.Log.Warn().Err(err).Msg("MCP active sessions query failed; serving fallback payload")
		return c.JSON(http.StatusOK, h.mcpPendingFallbackPayload(ctx))
	}
	defer sessionRows.Close()

	activeSessions := make([]mcpActiveSession, 0, 16)
	for sessionRows.Next() {
		var (
			tokenID        string
			securityLevel  string
			lastActivityAt time.Time
			pendingCount   int
			recentTools    []string
		)
		if err := sessionRows.Scan(&tokenID, &securityLevel, &lastActivityAt, &pendingCount, &recentTools); err != nil {
			logger.Log.Warn().Err(err).Msg("MCP active sessions parse failed; serving fallback payload")
			return c.JSON(http.StatusOK, h.mcpPendingFallbackPayload(ctx))
		}

		activeSessions = append(activeSessions, mcpActiveSession{
			TokenID:         tokenID,
			SecurityLevel:   normalizeMCPSecurityLevel(securityLevel),
			LastActivityAt:  lastActivityAt,
			PendingCount:    pendingCount,
			RecentTools:     recentTools,
			AvailableSkills: h.mcpSkillsForLevel(ctx, securityLevel),
			AvailableTools:  h.mcpAvailableToolsForLevel(ctx, securityLevel),
		})
	}

	indexed := make(map[string]struct{}, len(activeSessions))
	for _, session := range activeSessions {
		indexed[strings.TrimSpace(session.TokenID)] = struct{}{}
	}
	for _, live := range h.listRecentMCPLiveSessions(c.Request().Context(), 30*time.Minute) {
		tokenID := strings.TrimSpace(live.TokenID)
		if tokenID == "" {
			continue
		}
		if _, exists := indexed[tokenID]; exists {
			continue
		}
		live.PendingCount = 0
		live.AvailableSkills = h.mcpSkillsForLevel(ctx, live.SecurityLevel)
		live.AvailableTools = h.mcpAvailableToolsForLevel(ctx, live.SecurityLevel)
		activeSessions = append(activeSessions, live)
	}

	liveSessions := filterMCPActiveSessionsByWindow(activeSessions, mcpLivePresenceWindow)
	bridgeStatus := "degraded"
	if len(liveSessions) > 0 {
		bridgeStatus = "healthy"
	}

	return c.JSON(http.StatusOK, map[string]any{
		"items":                items,
		"approvals":            items,
		"count":                len(items),
		"active_sessions":      activeSessions,
		"active_sessions_live": liveSessions,
		"active_count":         len(activeSessions),
		"active_count_live":    len(liveSessions),
		"published_tools":      len(buildMCPTools()),
		"bridge_transport":     "jsonrpc-http",
		"bridge_status":        bridgeStatus,
	})
}

// ResolveMCPApproval handles POST /api/project/mcp/approvals/action
func (h *Handler) ResolveMCPApproval(c echo.Context) error {
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(c.Request().Context(), 18*time.Second)
	defer cancel()

	var req mcpApprovalActionRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid approval payload"})
	}

	req.RequestID = strings.TrimSpace(req.RequestID)
	if req.RequestID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "request_id is required"})
	}
	action := strings.ToLower(strings.TrimSpace(req.Action))
	if action != "approve" && action != "reject" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "action must be approve or reject"})
	}
	note := strings.TrimSpace(req.Note)

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start approval transaction"})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var (
		approvalID        string
		status            string
		tool              string
		tokenSecurity     string
		argsJSONText      string
		queueReason       string
		approvalWorkspace string
		existingApproved  string
		existingRejected  string
	)

	err = tx.QueryRow(ctx, `
		SELECT
			id::text,
			status,
			tool,
			token_security_level::text,
			arguments::text,
			COALESCE(reason, ''),
			COALESCE(workspace_id::text, ''),
			COALESCE(approved_by::text, ''),
			COALESCE(rejected_by::text, '')
		FROM _v_mcp_approvals
		WHERE id = $1::uuid
		FOR UPDATE
	`, req.RequestID).Scan(
		&approvalID,
		&status,
		&tool,
		&tokenSecurity,
		&argsJSONText,
		&queueReason,
		&approvalWorkspace,
		&existingApproved,
		&existingRejected,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "approval request not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to lock approval request"})
	}

	if status != "pending" {
		resolvedBy := strings.TrimSpace(existingApproved)
		if resolvedBy == "" {
			resolvedBy = strings.TrimSpace(existingRejected)
		}
		return c.JSON(http.StatusConflict, map[string]any{
			"error":       "approval request is already resolved",
			"request_id":  approvalID,
			"status":      status,
			"resolved_by": resolvedBy,
		})
	}

	actorUserID := actorUserIDFromContext(c)
	actorUserIDText := ""
	if actorUserID != nil {
		actorUserIDText = strings.TrimSpace(*actorUserID)
	}

	decision := evaluateMCPGuardrail(tokenSecurity, tool)
	arguments := decodeMCPApprovalArgs(argsJSONText)

	if action == "reject" {
		if _, err := tx.Exec(ctx, `
			UPDATE _v_mcp_approvals
			SET
				status = 'rejected',
				rejected_by = NULLIF($2, '')::uuid,
				rejected_at = NOW(),
				resolved_note = $3,
				updated_at = NOW()
			WHERE id = $1::uuid
		`, approvalID, actorUserIDText, note); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to reject approval request"})
		}

		if err := tx.Commit(ctx); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to finalize approval request"})
		}

		h.mcpAuditEvent(c, tool, arguments, decision, "rejected", time.Since(startedAt), nil)
		return c.JSON(http.StatusOK, map[string]any{
			"request_id":     approvalID,
			"status":         "rejected",
			"tool":           tool,
			"tool_risk":      decision.Risk,
			"security_level": decision.Level,
			"reason":         queueReason,
		})
	}

	execResult, execStatus, found, execErr := h.executeMCPTool(ctx, tool, arguments, approvalWorkspace)
	if !found {
		h.mcpAuditEvent(c, tool, arguments, decision, "unknown_tool", time.Since(startedAt), errors.New("unknown MCP tool during approval"))
		return c.JSON(http.StatusNotFound, map[string]string{"error": "unknown MCP tool in approval payload"})
	}
	if execErr != nil {
		h.mcpAuditEvent(c, tool, arguments, decision, "approval_execute_error", time.Since(startedAt), execErr)
		if execStatus >= 500 {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": execErr.Error()})
		}
		return c.JSON(http.StatusBadRequest, map[string]string{"error": execErr.Error()})
	}

	if _, err := tx.Exec(ctx, `
		UPDATE _v_mcp_approvals
		SET
			status = 'approved',
			approved_by = NULLIF($2, '')::uuid,
			approved_at = NOW(),
			resolved_note = $3,
			updated_at = NOW()
		WHERE id = $1::uuid
	`, approvalID, actorUserIDText, note); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to approve request after execution"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to finalize approved request"})
	}

	h.mcpAuditEvent(c, tool, arguments, decision, "approved_executed", time.Since(startedAt), nil)
	return c.JSON(http.StatusOK, map[string]any{
		"request_id":     approvalID,
		"status":         "approved",
		"tool":           tool,
		"result":         execResult,
		"tool_risk":      decision.Risk,
		"security_level": decision.Level,
		"reason":         queueReason,
	})
}

func (h *Handler) GetMCPManifest(c echo.Context) error {
	tools := buildStandardMCPTools()
	return c.JSON(http.StatusOK, map[string]any{
		"runtime":    "native",
		"transport":  "jsonrpc-http",
		"tool_count": len(tools),
		"tools":      tools,
	})
}

func buildMCPTools() []MCPTool {
	return []MCPTool{
		{
			Name:         "system.health",
			Description:  "Return backend health and SLO status summary.",
			RequiresAuth: true,
		},
		{
			Name:         "collections.list",
			Description:  "List user collections available in the current workspace.",
			RequiresAuth: true,
		},
		{
			Name:         "collections.create",
			Description:  "Create a collection/table with validated schema metadata.",
			RequiresAuth: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name":         map[string]any{"type": "string"},
					"display_name": map[string]any{"type": "string"},
					"list_rule": map[string]any{
						"type": "string",
						"enum": []string{"public", "auth", "admin"},
					},
					"create_rule": map[string]any{
						"type": "string",
						"enum": []string{"auth", "admin"},
					},
					"realtime_enabled": map[string]any{"type": "boolean"},
					"schema": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"name":       map[string]any{"type": "string"},
								"type":       map[string]any{"type": "string"},
								"required":   map[string]any{"type": "boolean"},
								"unique":     map[string]any{"type": "boolean"},
								"is_primary": map[string]any{"type": "boolean"},
								"default":    map[string]any{},
								"references": map[string]any{"type": "string"},
							},
							"required": []string{"name", "type"},
						},
					},
				},
				"required": []string{"name", "schema"},
			},
		},
		{
			Name:         "create_table",
			Description:  "Alias for collections.create to improve MCP interoperability.",
			RequiresAuth: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name":         map[string]any{"type": "string"},
					"display_name": map[string]any{"type": "string"},
					"list_rule": map[string]any{
						"type": "string",
						"enum": []string{"public", "auth", "admin"},
					},
					"create_rule": map[string]any{
						"type": "string",
						"enum": []string{"auth", "admin"},
					},
					"realtime_enabled": map[string]any{"type": "boolean"},
					"schema": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"name":       map[string]any{"type": "string"},
								"type":       map[string]any{"type": "string"},
								"required":   map[string]any{"type": "boolean"},
								"unique":     map[string]any{"type": "boolean"},
								"is_primary": map[string]any{"type": "boolean"},
								"default":    map[string]any{},
								"references": map[string]any{"type": "string"},
							},
							"required": []string{"name", "type"},
						},
					},
				},
				"required": []string{"name", "schema"},
			},
		},
		{
			Name:         "policies.enable_rls",
			Description:  "Enable Row Level Security for a target table.",
			RequiresAuth: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"table":  map[string]any{"type": "string"},
					"schema": map[string]any{"type": "string", "default": "public"},
				},
				"required": []string{"table"},
			},
		},
		{
			Name:         "enable_rls",
			Description:  "Alias for policies.enable_rls.",
			RequiresAuth: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"table":  map[string]any{"type": "string"},
					"schema": map[string]any{"type": "string", "default": "public"},
				},
				"required": []string{"table"},
			},
		},
		{
			Name:         "vector.status",
			Description:  "Return pgvector availability/install/readiness status.",
			RequiresAuth: true,
		},
		{
			Name:         "nlq.translate",
			Description:  "Translate natural language to deterministic SQL.",
			RequiresAuth: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string"},
					"table": map[string]any{"type": "string"},
					"limit": map[string]any{"type": "integer"},
				},
				"required": []string{"query"},
			},
		},
		{
			Name:         "nlq.query",
			Description:  "Execute deterministic NLQ query and return rows.",
			RequiresAuth: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string"},
					"table": map[string]any{"type": "string"},
					"limit": map[string]any{"type": "integer"},
				},
				"required": []string{"query"},
			},
		},
		{
			Name:         "get_project_awareness",
			Description:  "Return a summary of recent project engram activity and resource-level operations.",
			RequiresAuth: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"limit":        map[string]any{"type": "integer", "minimum": 1, "maximum": 100},
					"window_hours": map[string]any{"type": "integer", "minimum": 1, "maximum": 168},
					"resource":     map[string]any{"type": "string"},
				},
			},
		},
	}
}

func standardizeMCPInputSchema(schema map[string]any) map[string]any {
	if len(schema) == 0 {
		return map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		}
	}

	normalized := map[string]any{}
	for key, value := range schema {
		normalized[key] = value
	}
	if _, ok := normalized["type"]; !ok {
		normalized["type"] = "object"
	}
	if _, ok := normalized["properties"]; !ok {
		normalized["properties"] = map[string]any{}
	}
	if _, ok := normalized["additionalProperties"]; !ok {
		normalized["additionalProperties"] = false
	}
	return normalized
}

func buildStandardMCPTools() []map[string]any {
	tools := buildMCPTools()
	out := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		out = append(out, map[string]any{
			"name":        tool.Name,
			"description": tool.Description,
			"inputSchema": standardizeMCPInputSchema(tool.InputSchema),
		})
	}
	return out
}

func mcpStringArg(args map[string]any, key string) string {
	raw, ok := args[key]
	if !ok {
		return ""
	}
	s, ok := raw.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(s)
}

func mcpIntArg(args map[string]any, key string) int {
	raw, ok := args[key]
	if !ok || raw == nil {
		return 0
	}
	switch v := raw.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return 0
		}
		return n
	default:
		return 0
	}
}

func mcpBoolArg(args map[string]any, key string, defaultValue bool) bool {
	raw, ok := args[key]
	if !ok || raw == nil {
		return defaultValue
	}
	switch v := raw.(type) {
	case bool:
		return v
	case string:
		normalized := strings.ToLower(strings.TrimSpace(v))
		switch normalized {
		case "true", "1", "yes", "y":
			return true
		case "false", "0", "no", "n":
			return false
		default:
			return defaultValue
		}
	case int:
		return v != 0
	case int64:
		return v != 0
	case float64:
		return v != 0
	default:
		return defaultValue
	}
}

func normalizeACLRule(raw string, fallback string, allowed map[string]struct{}) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" {
		normalized = fallback
	}
	if _, ok := allowed[normalized]; ok {
		return normalized, nil
	}
	return "", fmt.Errorf("invalid ACL rule %q", raw)
}

func mcpParseFieldSchema(raw any) (data.FieldSchema, error) {
	m, ok := raw.(map[string]any)
	if !ok {
		return data.FieldSchema{}, errors.New("schema entries must be objects")
	}
	fieldName := strings.TrimSpace(mcpStringArg(m, "name"))
	fieldType := strings.TrimSpace(mcpStringArg(m, "type"))
	if fieldName == "" {
		return data.FieldSchema{}, errors.New("schema field name is required")
	}
	if fieldType == "" {
		return data.FieldSchema{}, fmt.Errorf("schema field %q type is required", fieldName)
	}
	if !data.IsValidIdentifier(fieldName) {
		return data.FieldSchema{}, fmt.Errorf("schema field %q is not a valid identifier", fieldName)
	}

	field := data.FieldSchema{
		Name:      fieldName,
		Type:      fieldType,
		Required:  mcpBoolArg(m, "required", false),
		Unique:    mcpBoolArg(m, "unique", false),
		IsPrimary: mcpBoolArg(m, "is_primary", false),
	}
	if refs := strings.TrimSpace(mcpStringArg(m, "references")); refs != "" {
		field.References = refs
	}
	if defaultValue, ok := m["default"]; ok {
		field.Default = defaultValue
	}
	return field, nil
}

func mcpParseSchema(args map[string]any) ([]data.FieldSchema, error) {
	raw, ok := args["schema"]
	if !ok {
		return nil, errors.New("schema is required")
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, errors.New("schema must be an array of fields")
	}
	if len(items) == 0 {
		return nil, errors.New("schema cannot be empty")
	}

	out := make([]data.FieldSchema, 0, len(items))
	for i, item := range items {
		field, err := mcpParseFieldSchema(item)
		if err != nil {
			return nil, fmt.Errorf("schema[%d]: %w", i, err)
		}
		out = append(out, field)
	}
	return out, nil
}

func (h *Handler) mcpCreateCollection(ctx context.Context, args map[string]any, workspaceID string) (map[string]any, error) {
	name := strings.TrimSpace(mcpStringArg(args, "name"))
	if name == "" {
		return nil, errors.New("name is required")
	}
	if !data.IsValidIdentifier(name) {
		return nil, fmt.Errorf("collection name %q is invalid", name)
	}
	lowerName := strings.ToLower(name)
	if strings.HasPrefix(lowerName, "_v_") || strings.HasPrefix(lowerName, "_ozy_") {
		return nil, errors.New("system-prefixed table names are not allowed")
	}

	schema, err := mcpParseSchema(args)
	if err != nil {
		return nil, err
	}

	displayName := strings.TrimSpace(mcpStringArg(args, "display_name"))
	if displayName == "" {
		displayName = name
	}
	listRule, err := normalizeACLRule(mcpStringArg(args, "list_rule"), "auth", map[string]struct{}{
		"public": {},
		"auth":   {},
		"admin":  {},
	})
	if err != nil {
		return nil, err
	}
	createRule, err := normalizeACLRule(mcpStringArg(args, "create_rule"), "admin", map[string]struct{}{
		"auth":  {},
		"admin": {},
	})
	if err != nil {
		return nil, err
	}
	realtimeEnabled := mcpBoolArg(args, "realtime_enabled", false)
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceArg := strings.TrimSpace(mcpStringArg(args, "workspace_id")); workspaceArg != "" {
		workspaceID = workspaceArg
	}

	createSQL, err := data.BuildCreateTableSQL(name, schema)
	if err != nil {
		return nil, err
	}

	schemaJSONBytes, err := json.Marshal(schema)
	if err != nil {
		return nil, fmt.Errorf("failed to encode schema: %w", err)
	}
	schemaJSON := string(schemaJSONBytes)

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var existed bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM _v_collections WHERE name = $1)", name).Scan(&existed); err != nil {
		return nil, fmt.Errorf("failed to inspect existing collection metadata: %w", err)
	}

	if _, err := tx.Exec(ctx, createSQL); err != nil {
		return nil, fmt.Errorf("failed to create collection table: %w", err)
	}

	if realtimeEnabled {
		triggerSQL := fmt.Sprintf(`
			CREATE TRIGGER tr_notify_%s
			AFTER INSERT OR UPDATE OR DELETE ON %s
			FOR EACH ROW EXECUTE FUNCTION notify_event();
		`, name, name)
		if _, err := tx.Exec(ctx, triggerSQL); err != nil {
			return nil, fmt.Errorf("failed to enable realtime trigger: %w", err)
		}
	}

	var collectionID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO _v_collections (name, display_name, schema_def, list_rule, create_rule, rls_enabled, realtime_enabled, workspace_id, updated_at)
		VALUES ($1, $2, $3, $4, $5, FALSE, $6, NULLIF($7, '')::uuid, NOW())
		ON CONFLICT (name) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			schema_def = EXCLUDED.schema_def,
			list_rule = EXCLUDED.list_rule,
			create_rule = EXCLUDED.create_rule,
			realtime_enabled = EXCLUDED.realtime_enabled,
			workspace_id = COALESCE(_v_collections.workspace_id, EXCLUDED.workspace_id),
			updated_at = NOW()
		RETURNING id::text
	`, name, displayName, schemaJSON, listRule, createRule, realtimeEnabled, workspaceID).Scan(&collectionID); err != nil {
		return nil, fmt.Errorf("failed to upsert collection metadata: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit collection creation: %w", err)
	}

	status := "created"
	if existed {
		status = "updated"
	}
	return map[string]any{
		"status":           status,
		"id":               collectionID,
		"name":             name,
		"display_name":     displayName,
		"list_rule":        listRule,
		"create_rule":      createRule,
		"realtime_enabled": realtimeEnabled,
		"schema_fields":    len(schema),
	}, nil
}

func (h *Handler) mcpHealth(ctx context.Context) map[string]any {
	status := "ok"
	errText := ""
	if err := h.DB.Health(ctx); err != nil {
		status = "degraded"
		errText = err.Error()
	}

	serviceSLO, sloErr := h.evaluateServiceSLO(ctx, false)
	if sloErr != nil {
		return map[string]any{
			"status":    status,
			"db_error":  errText,
			"slo_error": sloErr.Error(),
		}
	}
	if serviceSLO.Breached {
		status = "degraded"
	}

	return map[string]any{
		"status":       status,
		"db_error":     errText,
		"slo_status":   serviceSLO.Status,
		"slo_breached": serviceSLO.Breached,
		"evaluated_at": serviceSLO.EvaluatedAt,
	}
}

func (h *Handler) mcpCollections(ctx context.Context) ([]string, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT name
		FROM _v_collections
		WHERE name NOT LIKE '\_v\_%' ESCAPE '\'
		  AND name NOT LIKE '\_ozy\_%' ESCAPE '\'
		ORDER BY name ASC
		LIMIT 500
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0, 64)
	for rows.Next() {
		var name string
		if scanErr := rows.Scan(&name); scanErr != nil {
			continue
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		out = append(out, name)
	}
	return out, nil
}

func (h *Handler) mcpEnableRLS(ctx context.Context, args map[string]any) (map[string]any, error) {
	table := strings.TrimSpace(mcpStringArg(args, "table"))
	if table == "" {
		return nil, errors.New("table is required")
	}
	schemaName := strings.TrimSpace(mcpStringArg(args, "schema"))
	if schemaName == "" {
		schemaName = "public"
	}

	if !data.IsValidIdentifier(table) {
		return nil, fmt.Errorf("invalid table name %q", table)
	}
	if !data.IsValidIdentifier(schemaName) {
		return nil, fmt.Errorf("invalid schema name %q", schemaName)
	}

	qualifiedTextName := schemaName + "." + table
	var exists bool
	if err := h.DB.Pool.QueryRow(ctx, "SELECT to_regclass($1) IS NOT NULL", qualifiedTextName).Scan(&exists); err != nil {
		return nil, fmt.Errorf("failed to inspect table %s: %w", qualifiedTextName, err)
	}
	if !exists {
		return nil, fmt.Errorf("table %s does not exist", qualifiedTextName)
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if schemaName == "public" {
		if err := h.DB.EnableRLS(ctx, tx, table); err != nil {
			return nil, fmt.Errorf("failed to enable RLS: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE _v_collections
			SET rls_enabled = true, updated_at = NOW()
			WHERE name = $1
		`, table); err != nil {
			return nil, fmt.Errorf("failed to sync collection metadata: %w", err)
		}
	} else {
		qualified := data.QuoteIdentifier(schemaName) + "." + data.QuoteIdentifier(table)
		if _, err := tx.Exec(ctx, "ALTER TABLE "+qualified+" ENABLE ROW LEVEL SECURITY"); err != nil {
			return nil, fmt.Errorf("failed to enable RLS: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit RLS change: %w", err)
	}

	return map[string]any{
		"status": "enabled",
		"schema": schemaName,
		"table":  table,
	}, nil
}

func (h *Handler) executeMCPTool(ctx context.Context, tool string, arguments map[string]any, workspaceID string) (any, int, bool, error) {
	switch tool {
	case "system.health":
		return h.mcpHealth(ctx), http.StatusOK, true, nil
	case "collections.list":
		items, err := h.mcpCollections(ctx)
		if err != nil {
			return nil, http.StatusInternalServerError, true, err
		}
		return map[string]any{"items": items, "count": len(items)}, http.StatusOK, true, nil
	case "collections.create", "create_table":
		result, err := h.mcpCreateCollection(ctx, arguments, workspaceID)
		if err != nil {
			return nil, http.StatusBadRequest, true, err
		}
		return result, http.StatusOK, true, nil
	case "policies.enable_rls", "enable_rls":
		result, err := h.mcpEnableRLS(ctx, arguments)
		if err != nil {
			return nil, http.StatusBadRequest, true, err
		}
		return result, http.StatusOK, true, nil
	case "vector.status":
		result, err := h.collectVectorStatus(ctx)
		if err != nil {
			return nil, http.StatusInternalServerError, true, err
		}
		return result, http.StatusOK, true, nil
	case "nlq.translate":
		nlqReq := NLQTranslateRequest{
			Query: mcpStringArg(arguments, "query"),
			Table: mcpStringArg(arguments, "table"),
			Limit: mcpIntArg(arguments, "limit"),
		}
		result, err := h.translateNLQ(ctx, nlqReq)
		if err != nil {
			return nil, http.StatusBadRequest, true, err
		}
		return result, http.StatusOK, true, nil
	case "nlq.query":
		nlqReq := NLQTranslateRequest{
			Query: mcpStringArg(arguments, "query"),
			Table: mcpStringArg(arguments, "table"),
			Limit: mcpIntArg(arguments, "limit"),
		}
		result, err := h.runNLQ(ctx, nlqReq)
		if err != nil {
			return nil, http.StatusBadRequest, true, err
		}
		return result, http.StatusOK, true, nil
	case "get_project_awareness":
		result, err := h.mcpProjectAwareness(ctx, arguments)
		if err != nil {
			return nil, http.StatusInternalServerError, true, err
		}
		return result, http.StatusOK, true, nil
	default:
		return nil, http.StatusNotFound, false, errors.New("unknown MCP tool")
	}
}

func newMCPRPCResponse(id any, result any) MCPRPCResponse {
	return MCPRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
}

func newMCPRPCError(id any, code int, message string) MCPRPCResponse {
	return MCPRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &MCPRPCError{
			Code:    code,
			Message: message,
		},
	}
}

func encodeMCPToolContent(result any) string {
	if result == nil {
		return "{}"
	}
	payload, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", result)
	}
	return string(payload)
}

// GetMCPTools handles GET /api/project/mcp/tools
func (h *Handler) GetMCPTools(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{
		"runtime": "native",
		"count":   len(buildMCPTools()),
		"tools":   buildMCPTools(),
	})
}

// InvokeMCPTool handles POST /api/project/mcp/invoke
func (h *Handler) InvokeMCPTool(c echo.Context) error {
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(c.Request().Context(), 12*time.Second)
	defer cancel()

	var req MCPInvokeRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid MCP payload"})
	}
	req.Tool = strings.TrimSpace(req.Tool)
	if req.Tool == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "tool is required"})
	}
	if req.Arguments == nil {
		req.Arguments = map[string]any{}
	}

	decision, approvalID, decisionErr := h.enforceMCPGuardrails(ctx, c, req.Tool, req.Arguments)
	if decisionErr != nil {
		resolvedTokenID, _, _, _ := resolveMCPAgentIdentity(c)
		_, targetResource := deriveMCPResourceDetails(req.Tool, req.Arguments)
		blockedMessage := buildMCPBlockedStatusMessage(resolvedTokenID, decision.Level, req.Tool, targetResource)
		if forced, ok := c.Get("mcp_blocked_status_msg").(string); ok && strings.TrimSpace(forced) != "" {
			blockedMessage = strings.TrimSpace(forced)
		}
		h.mcpAuditEvent(c, req.Tool, req.Arguments, decision, mcpGuardrailActionBlocked, time.Since(startedAt), decisionErr)
		statusCode := http.StatusForbidden
		resultCode := mcpGuardrailActionBlocked
		payload := map[string]any{
			"error":            decisionErr.Error(),
			"message":          blockedMessage,
			"critical":         true,
			"security_level":   decision.Level,
			"guardrail_source": decision.GuardrailSource,
			"tool_risk":        decision.Risk,
			"result":           resultCode,
		}
		if hardLock, _ := c.Get("mcp_hard_lock_required").(bool); hardLock {
			statusCode = http.StatusLocked
			resultCode = "hard_lock_active"
			payload["result"] = resultCode
			payload["action"] = "REQUIRES_DOUBLE_CONFIRMATION"
			if token, ok := c.Get("mcp_hard_lock_token").(string); ok && strings.TrimSpace(token) != "" {
				payload["challenge_token"] = strings.TrimSpace(token)
			}
		}
		return c.JSON(statusCode, payload)
	}
	if decision.Action == mcpGuardrailActionPending {
		h.mcpAuditEvent(c, req.Tool, req.Arguments, decision, mcpGuardrailActionPending, time.Since(startedAt), nil)
		return c.JSON(http.StatusAccepted, map[string]any{
			"status":           "awaiting_approval",
			"request_id":       approvalID,
			"tool":             req.Tool,
			"security_level":   decision.Level,
			"guardrail_source": decision.GuardrailSource,
			"tool_risk":        decision.Risk,
		})
	}

	workspaceID, _ := c.Get("workspace_id").(string)
	result, status, found, err := h.executeMCPTool(ctx, req.Tool, req.Arguments, workspaceID)
	if !found {
		h.mcpAuditEvent(c, req.Tool, req.Arguments, decision, "unknown_tool", time.Since(startedAt), errors.New("unknown MCP tool"))
		return c.JSON(http.StatusNotFound, map[string]string{"error": "unknown MCP tool"})
	}
	if err != nil {
		h.mcpAuditEvent(c, req.Tool, req.Arguments, decision, "error", time.Since(startedAt), err)
		return c.JSON(status, map[string]string{"error": err.Error()})
	}
	h.mcpAuditEvent(c, req.Tool, req.Arguments, decision, "executed", time.Since(startedAt), nil)
	return c.JSON(http.StatusOK, map[string]any{
		"tool":   req.Tool,
		"result": result,
	})
}

// HandleMCPRPC exposes a standard JSON-RPC MCP endpoint for editor integrations.
func (h *Handler) HandleMCPRPC(c echo.Context) error {
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(c.Request().Context(), 12*time.Second)
	defer cancel()

	var req MCPRPCRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, newMCPRPCError(nil, -32700, "invalid JSON payload"))
	}
	if strings.TrimSpace(req.Method) == "" {
		return c.JSON(http.StatusBadRequest, newMCPRPCError(req.ID, -32600, "method is required"))
	}

	method := strings.TrimSpace(req.Method)
	params := req.Params
	if params == nil {
		params = map[string]any{}
	}

	if strings.HasPrefix(method, "notifications/") {
		return c.NoContent(http.StatusAccepted)
	}

	sessionID, sessionLevel, sessionName, sessionUserAgent := resolveMCPAgentIdentity(c)
	isApproved := false
	mcpLiveSessionsMu.Lock()
	sessionKey := buildMCPLiveSessionKey(canonicalMCPTokenID(sessionID), sessionName, sessionUserAgent)
	if sess, ok := mcpLiveSessions[sessionKey]; ok {
		isApproved = sess.IsApproved
	}
	mcpLiveSessionsMu.Unlock()

	// If not approved, block all methods except 'initialize'
	if method != "initialize" && !isApproved {
		return c.JSON(http.StatusForbidden, newMCPRPCError(req.ID, -32000, "agent connection pending approval"))
	}

	switch method {
	case "initialize":
		protocolVersion := mcpStringArg(params, "protocolVersion")
		if protocolVersion == "" {
			protocolVersion = "2025-06-18"
		}

		clientName := extractMCPClientName(params)
		if clientName == "" {
			clientName = strings.TrimSpace(c.Request().Header.Get("X-Client-Name"))
		}
		if clientName == "" {
			clientName = strings.TrimSpace(c.Request().Header.Get("X-Editor"))
		}
		if clientName == "" {
			clientName = strings.TrimSpace(c.Request().Header.Get("X-MCP-Client"))
		}
		sessionName = normalizeMCPClientDisplayName(clientName, sessionName)
		h.registerMCPLiveSession(ctx, sessionID, sessionLevel, "", "idle", sessionName, sessionUserAgent, startedAt)
		globalMCPStreamBroker.Publish(mcpStreamEvent{
			EventType:     "mcp_presence",
			Event:         "mcp_presence",
			AgentTokenID:  sessionID,
			AgentName:     sessionName,
			UserAgent:     sessionUserAgent,
			SecurityLevel: sessionLevel,
			Result:        "idle",
			StatusMsg:     "connected",
			Icon:          inferMCPIcon(sessionUserAgent, sessionName),
			Timestamp:     time.Now(),
		})

		return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities": map[string]any{
				"tools": map[string]any{
					"listChanged": false,
				},
			},
			"serverInfo": map[string]any{
				"name":    "OzyBase",
				"version": "2026.03",
			},
			"instructions": "Use tools/list and tools/call to access the OzyBase MCP runtime.",
		}))
	case "ping":
		sessionID, sessionLevel, sessionName, sessionUserAgent := resolveMCPAgentIdentity(c)
		h.registerMCPLiveSession(ctx, sessionID, sessionLevel, "", "idle", sessionName, sessionUserAgent, startedAt)
		return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{}))
	case "tools/list":
		return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{
			"tools": buildStandardMCPTools(),
		}))
	case "tools/call":
		toolName := mcpStringArg(params, "name")
		if toolName == "" {
			return c.JSON(http.StatusBadRequest, newMCPRPCError(req.ID, -32602, "tool name is required"))
		}

		rawArgs, ok := params["arguments"]
		if !ok || rawArgs == nil {
			rawArgs = map[string]any{}
		}
		args, ok := rawArgs.(map[string]any)
		if !ok {
			return c.JSON(http.StatusBadRequest, newMCPRPCError(req.ID, -32602, "tool arguments must be an object"))
		}

		decision, approvalID, decisionErr := h.enforceMCPGuardrails(ctx, c, toolName, args)
		if decisionErr != nil {
			resolvedTokenID, _, _, _ := resolveMCPAgentIdentity(c)
			_, targetResource := deriveMCPResourceDetails(toolName, args)
			blockedMessage := buildMCPBlockedStatusMessage(resolvedTokenID, decision.Level, toolName, targetResource)
			if forced, ok := c.Get("mcp_blocked_status_msg").(string); ok && strings.TrimSpace(forced) != "" {
				blockedMessage = strings.TrimSpace(forced)
			}
			resultCode := mcpGuardrailActionBlocked
			action := ""
			challengeToken := ""
			if hardLock, _ := c.Get("mcp_hard_lock_required").(bool); hardLock {
				resultCode = "hard_lock_active"
				action = "REQUIRES_DOUBLE_CONFIRMATION"
				if token, ok := c.Get("mcp_hard_lock_token").(string); ok && strings.TrimSpace(token) != "" {
					challengeToken = strings.TrimSpace(token)
				}
			}
			h.mcpAuditEvent(c, toolName, args, decision, mcpGuardrailActionBlocked, time.Since(startedAt), decisionErr)
			structured := map[string]any{
				"tool":             toolName,
				"result":           resultCode,
				"security_level":   decision.Level,
				"guardrail_source": decision.GuardrailSource,
				"tool_risk":        decision.Risk,
				"error":            decisionErr.Error(),
				"message":          blockedMessage,
				"critical":         true,
			}
			if action != "" {
				structured["action"] = action
			}
			if challengeToken != "" {
				structured["challenge_token"] = challengeToken
			}
			return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{
				"content": []map[string]any{
					{"type": "text", "text": blockedMessage},
				},
				"structuredContent": structured,
				"isError":           true,
			}))
		}
		if decision.Action == mcpGuardrailActionPending {
			h.mcpAuditEvent(c, toolName, args, decision, mcpGuardrailActionPending, time.Since(startedAt), nil)
			return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{
				"content": []map[string]any{
					{"type": "text", "text": "awaiting approval"},
				},
				"structuredContent": map[string]any{
					"tool":             toolName,
					"result":           mcpGuardrailActionPending,
					"request_id":       approvalID,
					"security_level":   decision.Level,
					"guardrail_source": decision.GuardrailSource,
					"tool_risk":        decision.Risk,
				},
				"isError": false,
			}))
		}

		workspaceID, _ := c.Get("workspace_id").(string)
		result, _, found, err := h.executeMCPTool(ctx, toolName, args, workspaceID)
		if !found {
			h.mcpAuditEvent(c, toolName, args, decision, "unknown_tool", time.Since(startedAt), errors.New("unknown MCP tool"))
			return c.JSON(http.StatusNotFound, newMCPRPCError(req.ID, -32601, "unknown MCP tool"))
		}
		if err != nil {
			h.mcpAuditEvent(c, toolName, args, decision, "error", time.Since(startedAt), err)
			return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{
				"content": []map[string]any{
					{"type": "text", "text": err.Error()},
				},
				"structuredContent": map[string]any{
					"tool":  toolName,
					"error": err.Error(),
				},
				"isError": true,
			}))
		}
		h.mcpAuditEvent(c, toolName, args, decision, "executed", time.Since(startedAt), nil)

		return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{
			"content": []map[string]any{
				{"type": "text", "text": encodeMCPToolContent(result)},
			},
			"structuredContent": result,
		}))
	default:
		return c.JSON(http.StatusNotFound, newMCPRPCError(req.ID, -32601, "method not found"))
	}
}

type UpdateTokenRequest struct {
	FriendlyName  string   `json:"friendly_name"`
	Policies      []string `json:"policies"`
	SecurityLevel string   `json:"security_level"`
	AutonomyLevel string   `json:"autonomy_level"`
	Action        string   `json:"action"`
}

func mcpTokenMatches(candidate, target string) bool {
	candidate = strings.TrimSpace(candidate)
	target = strings.TrimSpace(target)
	if candidate == "" || target == "" {
		return false
	}
	if strings.EqualFold(candidate, target) {
		return true
	}
	cLower := canonicalMCPTokenID(candidate)
	tLower := canonicalMCPTokenID(target)
	return cLower != "" && tLower != "" && cLower == tLower
}

func (h *Handler) UpdateAgentConfig(c echo.Context) error {
	tokenID := c.Param("id")
	if decoded, err := url.PathUnescape(tokenID); err == nil && strings.TrimSpace(decoded) != "" {
		tokenID = decoded
	}
	if tokenID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "token id is required"})
	}

	var req UpdateTokenRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request payload"})
	}

	securityLevel := ""
	if strings.TrimSpace(req.SecurityLevel) != "" {
		securityLevel = normalizeMCPSecurityLevel(req.SecurityLevel)
		raw := strings.ToLower(strings.TrimSpace(req.SecurityLevel))
		if raw != mcpSecurityLevelLibre && raw != mcpSecurityLevelMedio && raw != mcpSecurityLevelRestringido {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid security_level"})
		}
	}
	autonomyLevel := ""
	if strings.TrimSpace(req.AutonomyLevel) != "" {
		autonomyLevel = normalizeEngramAutonomyLevel(req.AutonomyLevel)
		raw := strings.ToUpper(strings.TrimSpace(req.AutonomyLevel))
		if raw != engramAutonomyLevelL1 && raw != engramAutonomyLevelL2 && raw != engramAutonomyLevelL3 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid autonomy_level"})
		}
	}
	action := strings.ToLower(strings.TrimSpace(req.Action))
	if action != "" && action != "disconnect" && action != "delete" && action != "approve" && action != "reject" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid action"})
	}

	ctx := c.Request().Context()
	trimmedTokenID := strings.TrimSpace(tokenID)
	canonicalTokenID := canonicalMCPTokenID(trimmedTokenID)
	isPersistentToken := isUUIDLike(trimmedTokenID)
	persistedSecurityLevel := false
	persistedAutonomyLevel := false
	persistedFriendlyName := false
	matchedLiveSession := false

	if action != "" {
		now := time.Now().UTC()
		mcpLiveSessionsMu.Lock()
		for key, current := range mcpLiveSessions {
			if mcpTokenMatches(current.TokenID, trimmedTokenID) || mcpTokenMatches(key, trimmedTokenID) {
				matchedLiveSession = true
				if action == "delete" || action == "reject" {
					delete(mcpLiveSessions, key)
					continue
				}
				if action == "approve" {
					current.IsApproved = true
				} else {
					current.Status = "disconnected"
				}
				current.LastActivityAt = now
				mcpLiveSessions[key] = current
			}
		}
		if (action == "delete" || action == "reject") && canonicalTokenID != "" {
			delete(mcpAgentOverrides, canonicalTokenID)
		}
		mcpLiveSessionsMu.Unlock()

		switch action {
		case "delete", "reject":
			_, err := h.DB.Pool.Exec(ctx, `
				DELETE FROM "_v_active_mcp_sessions"
				WHERE lower(agent_id) = lower($1) OR lower(agent_id) LIKE lower($1) || '@%'
			`, trimmedTokenID)
			if err != nil && !isMissingMCPSchemaError(err) {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to delete active agent session"})
			}
		case "approve":
			_, err := h.DB.Pool.Exec(ctx, `
				UPDATE "_v_active_mcp_sessions"
				SET is_approved = true, last_seen = NOW()
				WHERE lower(agent_id) = lower($1) OR lower(agent_id) LIKE lower($1) || '@%'
			`, trimmedTokenID)
			if err != nil && !isMissingMCPSchemaError(err) {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to approve active agent session"})
			}
		default:
			_, err := h.DB.Pool.Exec(ctx, `
				UPDATE "_v_active_mcp_sessions"
				SET status = 'disconnected', last_seen = NOW()
				WHERE lower(agent_id) = lower($1) OR lower(agent_id) LIKE lower($1) || '@%'
			`, trimmedTokenID)
			if err != nil && !isMissingMCPSchemaError(err) {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to disconnect active agent session"})
			}
		}
	}

	if strings.TrimSpace(req.FriendlyName) != "" {
		if isPersistentToken {
			tag, err := h.DB.Pool.Exec(ctx, `
				UPDATE _v_api_keys
				SET friendly_name = $1
				WHERE id = $2::uuid
			`, req.FriendlyName, tokenID)
			if err != nil {
				if isMissingMCPSchemaError(err) {
					_, _ = h.DB.Pool.Exec(ctx, `
						ALTER TABLE IF EXISTS "_v_api_keys"
						ADD COLUMN IF NOT EXISTS friendly_name VARCHAR(255) DEFAULT 'Unnamed Agent'
					`)
					tag, err = h.DB.Pool.Exec(ctx, `
						UPDATE _v_api_keys
						SET friendly_name = $1
						WHERE id = $2::uuid
					`, req.FriendlyName, tokenID)
				}
				if err != nil {
					return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to update agent config"})
				}
			}
			if tag.RowsAffected() > 0 {
				persistedFriendlyName = true
			}
		} else {
			logger.Log.Info().Str("token_id", trimmedTokenID).Msg("agent friendly_name applied as live-session override only")
		}

		updatedName := strings.TrimSpace(req.FriendlyName)
		mcpLiveSessionsMu.Lock()
		if canonicalTokenID != "" {
			override := mcpAgentOverrides[canonicalTokenID]
			override.Name = updatedName
			mcpAgentOverrides[canonicalTokenID] = override
		}
		for key, current := range mcpLiveSessions {
			if mcpTokenMatches(current.TokenID, trimmedTokenID) || mcpTokenMatches(key, trimmedTokenID) {
				matchedLiveSession = true
				current.Name = updatedName
				current.LastActivityAt = time.Now().UTC()
				mcpLiveSessions[key] = current
			}
		}
		mcpLiveSessionsMu.Unlock()
	}

	if strings.TrimSpace(req.SecurityLevel) != "" {
		if isPersistentToken {
			tag, err := h.DB.Pool.Exec(ctx, `
				UPDATE _v_api_keys
				SET security_level = $1::mcp_security_level
				WHERE id = $2::uuid
			`, securityLevel, tokenID)
			if err != nil {
				if isMissingMCPSchemaError(err) {
					if schemaErr := h.ensureMCPApprovalsSchema(ctx); schemaErr != nil {
						return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to auto-heal security schema"})
					}
					tag, err = h.DB.Pool.Exec(ctx, `
						UPDATE _v_api_keys
						SET security_level = $1::mcp_security_level
						WHERE id = $2::uuid
					`, securityLevel, tokenID)
				}
				if err != nil {
					return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to update security level"})
				}
			}
			if tag.RowsAffected() > 0 {
				persistedSecurityLevel = true
			}
		} else {
			logger.Log.Info().Str("token_id", trimmedTokenID).Msg("agent security_level applied as live-session override only")
		}

		mcpLiveSessionsMu.Lock()
		if canonicalTokenID != "" {
			override := mcpAgentOverrides[canonicalTokenID]
			override.SecurityLevel = securityLevel
			mcpAgentOverrides[canonicalTokenID] = override
		}
		for key, current := range mcpLiveSessions {
			if mcpTokenMatches(current.TokenID, trimmedTokenID) || mcpTokenMatches(key, trimmedTokenID) {
				matchedLiveSession = true
				current.SecurityLevel = securityLevel
				current.LastActivityAt = time.Now().UTC()
				mcpLiveSessions[key] = current
			}
		}
		mcpLiveSessionsMu.Unlock()
	}

	if strings.TrimSpace(req.AutonomyLevel) != "" {
		tag, err := h.DB.Pool.Exec(ctx, `
			UPDATE "_v_active_mcp_sessions"
			SET autonomy_level = $1, last_seen = NOW()
			WHERE lower(agent_id) = lower($2) OR lower(agent_id) LIKE lower($2) || '@%'
		`, autonomyLevel, trimmedTokenID)
		if err != nil && !isMissingMCPSchemaError(err) {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to update autonomy level"})
		}
		if err == nil && tag.RowsAffected() > 0 {
			persistedAutonomyLevel = true
		}
		if err == nil && tag.RowsAffected() == 0 && !isPersistentToken {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "agent session not found for autonomy update"})
		}

		mcpLiveSessionsMu.Lock()
		if canonicalTokenID != "" {
			override := mcpAgentOverrides[canonicalTokenID]
			override.AutonomyLevel = autonomyLevel
			mcpAgentOverrides[canonicalTokenID] = override
		}
		for key, current := range mcpLiveSessions {
			if mcpTokenMatches(current.TokenID, trimmedTokenID) || mcpTokenMatches(key, trimmedTokenID) {
				matchedLiveSession = true
				current.AutonomyLevel = autonomyLevel
				current.LastActivityAt = time.Now().UTC()
				mcpLiveSessions[key] = current
			}
		}
		mcpLiveSessionsMu.Unlock()
	}

	if !isPersistentToken && strings.TrimSpace(req.FriendlyName) == "" && strings.TrimSpace(req.SecurityLevel) == "" && strings.TrimSpace(req.AutonomyLevel) == "" && action == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "no changes requested"})
	}
	if !isPersistentToken && !matchedLiveSession {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "agent session not found"})
	}

	if strings.TrimSpace(req.FriendlyName) != "" || strings.TrimSpace(req.SecurityLevel) != "" || strings.TrimSpace(req.AutonomyLevel) != "" || action != "" {
		logger.Log.Info().
			Str("module", "governance").
			Str("event", "manual_override").
			Str("agent_id", trimmedTokenID).
			Str("security_level", securityLevel).
			Str("autonomy_level", autonomyLevel).
			Str("friendly_name", strings.TrimSpace(req.FriendlyName)).
			Str("action", action).
			Msg("[GOVERNANCE] Manual override applied")
	}

	globalMCPStreamBroker.Publish(mcpStreamEvent{
		EventType:     "agent_config_updated",
		Event:         "ConfigUpdated",
		AgentTokenID:  tokenID,
		AgentName:     req.FriendlyName,
		SecurityLevel: securityLevel,
		ActivityKind:  mcpActivityKindSystem,
		PipelineFX:    mcpPipelineFXFlow,
		Timestamp:     time.Now(),
	})

	return c.JSON(http.StatusOK, map[string]any{
		"status":                   "success",
		"message":                  "agent config updated",
		"token_id":                 tokenID,
		"action":                   action,
		"security_level":           securityLevel,
		"autonomy_level":           autonomyLevel,
		"persisted_security_level": persistedSecurityLevel,
		"persisted_autonomy_level": persistedAutonomyLevel,
		"persisted_friendly_name":  persistedFriendlyName,
	})
}

func inferMCPIcon(userAgent, name string) string {
	icon := "mcp"
	uaLower := strings.ToLower(userAgent)
	nameLower := strings.ToLower(name)
	combined := uaLower + " " + nameLower
	if strings.Contains(combined, "cursor") {
		icon = "cursor"
	} else if strings.Contains(combined, "vscode") || strings.Contains(combined, "visual studio code") {
		icon = "vscode"
	} else if strings.Contains(combined, "antigravity") {
		icon = "antigravity"
	} else if strings.Contains(combined, "python") {
		icon = "python"
	} else if strings.Contains(combined, "claude") {
		icon = "claude"
	}
	return icon
}

