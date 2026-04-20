package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

type mcpSkillDefinition struct {
	ID              string
	Name            string
	Description     string
	Icon            string
	Tools           []string
	DefaultEnabled  bool
	DefaultMinLevel string
}

type mcpSkillPolicy struct {
	Enabled  bool   `json:"enabled"`
	MinLevel string `json:"min_level"`
}

type mcpSkillStoreItem struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Icon        string   `json:"icon"`
	Enabled     bool     `json:"enabled"`
	MinLevel    string   `json:"min_level"`
	UsageCount  int      `json:"usage_count"`
	Tools       []string `json:"tools"`
}

type mcpSkillStoreUpdateRequest struct {
	SkillID  string  `json:"skill_id"`
	Enabled  *bool   `json:"enabled"`
	MinLevel *string `json:"min_level"`
}

var mcpSkillDefinitions = []mcpSkillDefinition{
	{
		ID:              "system_observer",
		Name:            "System Observer",
		Description:     "Monitors system health and explores schema surfaces.",
		Icon:            "radar",
		Tools:           []string{"system.health", "collections.list"},
		DefaultEnabled:  true,
		DefaultMinLevel: mcpSecurityLevelRestringido,
	},
	{
		ID:              "data_architect",
		Name:            "Data Architect",
		Description:     "Designs and evolves data structures safely.",
		Icon:            "table",
		Tools:           []string{"collections.create", "create_table"},
		DefaultEnabled:  true,
		DefaultMinLevel: mcpSecurityLevelMedio,
	},
	{
		ID:              "security_guard",
		Name:            "Security Guard",
		Description:     "Reinforces security posture with RLS controls.",
		Icon:            "shield",
		Tools:           []string{"policies.enable_rls", "enable_rls"},
		DefaultEnabled:  true,
		DefaultMinLevel: mcpSecurityLevelMedio,
	},
	{
		ID:              "insight_engine",
		Name:            "Insight Engine",
		Description:     "Runs semantic discovery and natural-language insights.",
		Icon:            "sparkles",
		Tools:           []string{"nlq.translate", "nlq.query", "vector.status"},
		DefaultEnabled:  true,
		DefaultMinLevel: mcpSecurityLevelRestringido,
	},
}

var mcpSkillDefinitionByID = func() map[string]mcpSkillDefinition {
	out := make(map[string]mcpSkillDefinition, len(mcpSkillDefinitions))
	for _, def := range mcpSkillDefinitions {
		out[def.ID] = def
	}
	return out
}()

var mcpSkillIDByTool = func() map[string]string {
	out := map[string]string{}
	for _, def := range mcpSkillDefinitions {
		for _, toolName := range def.Tools {
			tool := strings.TrimSpace(toolName)
			if tool == "" {
				continue
			}
			out[tool] = def.ID
		}
	}
	return out
}()

var mcpSkillStore = struct {
	mu       sync.RWMutex
	loaded   bool
	policies map[string]mcpSkillPolicy
	usage    map[string]int
}{
	policies: map[string]mcpSkillPolicy{},
	usage:    map[string]int{},
}



func defaultMCPSkillPolicies() map[string]mcpSkillPolicy {
	out := make(map[string]mcpSkillPolicy, len(mcpSkillDefinitions))
	for _, def := range mcpSkillDefinitions {
		out[def.ID] = mcpSkillPolicy{
			Enabled:  def.DefaultEnabled,
			MinLevel: normalizeMCPSecurityLevel(def.DefaultMinLevel),
		}
	}
	return out
}

func normalizeMCPSkillPolicy(policy mcpSkillPolicy, fallback mcpSkillPolicy) mcpSkillPolicy {
	policy.MinLevel = normalizeMCPSecurityLevel(firstNonEmpty(policy.MinLevel, fallback.MinLevel))
	if policy.MinLevel == "" {
		policy.MinLevel = mcpSecurityLevelLibre
	}
	return policy
}

func mcpSkillDefinitionForTool(toolName string) (mcpSkillDefinition, bool) {
	skillID, ok := mcpSkillIDByTool[strings.TrimSpace(toolName)]
	if !ok {
		return mcpSkillDefinition{}, false
	}
	def, ok := mcpSkillDefinitionByID[skillID]
	if !ok {
		return mcpSkillDefinition{}, false
	}
	return def, true
}

func (h *Handler) ensureMCPSkillStoreLoaded(ctx context.Context) error {
	mcpSkillStore.mu.RLock()
	if mcpSkillStore.loaded {
		mcpSkillStore.mu.RUnlock()
		return nil
	}
	mcpSkillStore.mu.RUnlock()

	policies := defaultMCPSkillPolicies()

	if h != nil && h.DB != nil && h.DB.Pool != nil {
		var raw []byte
		err := h.DB.Pool.QueryRow(ctx, `
			SELECT config
			FROM _v_security_policies
			WHERE type = 'mcp_skill_store'
		`).Scan(&raw)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if len(raw) > 0 {
			var payload struct {
				Skills map[string]mcpSkillPolicy `json:"skills"`
			}
			if unmarshalErr := json.Unmarshal(raw, &payload); unmarshalErr == nil {
				for skillID, persisted := range payload.Skills {
					base, ok := policies[skillID]
					if !ok {
						continue
					}
					policies[skillID] = normalizeMCPSkillPolicy(persisted, base)
				}
			}
		}
	}

	mcpSkillStore.mu.Lock()
	if !mcpSkillStore.loaded {
		mcpSkillStore.policies = policies
		if mcpSkillStore.usage == nil {
			mcpSkillStore.usage = map[string]int{}
		}
		mcpSkillStore.loaded = true
	}
	mcpSkillStore.mu.Unlock()
	return nil
}

func (h *Handler) persistMCPSkillPolicies(ctx context.Context, policies map[string]mcpSkillPolicy) error {
	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return nil
	}

	payload := map[string]any{"skills": policies}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	_, err = h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_security_policies (type, config, updated_at)
		VALUES ('mcp_skill_store', $1::jsonb, NOW())
		ON CONFLICT (type) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
	`, string(encoded))
	return err
}

func (h *Handler) mcpSkillStoreSnapshot(ctx context.Context) ([]mcpSkillStoreItem, error) {
	if err := h.ensureMCPSkillStoreLoaded(ctx); err != nil {
		return nil, err
	}

	mcpSkillStore.mu.RLock()
	defer mcpSkillStore.mu.RUnlock()

	items := make([]mcpSkillStoreItem, 0, len(mcpSkillDefinitions))
	for _, def := range mcpSkillDefinitions {
		policy := normalizeMCPSkillPolicy(mcpSkillStore.policies[def.ID], mcpSkillPolicy{
			Enabled:  def.DefaultEnabled,
			MinLevel: def.DefaultMinLevel,
		})
		items = append(items, mcpSkillStoreItem{
			ID:          def.ID,
			Name:        def.Name,
			Description: def.Description,
			Icon:        def.Icon,
			Enabled:     policy.Enabled,
			MinLevel:    policy.MinLevel,
			UsageCount:  mcpSkillStore.usage[def.ID],
			Tools:       append([]string{}, def.Tools...),
		})
	}

	return items, nil
}

func (h *Handler) mcpSkillPolicyForID(ctx context.Context, skillID string) (mcpSkillPolicy, mcpSkillDefinition, bool, error) {
	def, ok := mcpSkillDefinitionByID[strings.TrimSpace(skillID)]
	if !ok {
		return mcpSkillPolicy{}, mcpSkillDefinition{}, false, nil
	}
	if err := h.ensureMCPSkillStoreLoaded(ctx); err != nil {
		return mcpSkillPolicy{}, mcpSkillDefinition{}, false, err
	}

	mcpSkillStore.mu.RLock()
	policy := normalizeMCPSkillPolicy(mcpSkillStore.policies[def.ID], mcpSkillPolicy{
		Enabled:  def.DefaultEnabled,
		MinLevel: def.DefaultMinLevel,
	})
	mcpSkillStore.mu.RUnlock()
	return policy, def, true, nil
}

func (h *Handler) mcpSkillPolicyForTool(ctx context.Context, toolName string) (mcpSkillPolicy, mcpSkillDefinition, bool, error) {
	def, ok := mcpSkillDefinitionForTool(toolName)
	if !ok {
		return mcpSkillPolicy{}, mcpSkillDefinition{}, false, nil
	}
	policy, _, _, err := h.mcpSkillPolicyForID(ctx, def.ID)
	if err != nil {
		return mcpSkillPolicy{}, mcpSkillDefinition{}, false, err
	}
	return policy, def, true, nil
}

func (h *Handler) mcpSkillAllowsLevel(ctx context.Context, toolName, securityLevel string) (bool, string, mcpSkillDefinition, mcpSkillPolicy) {
	policy, def, found, err := h.mcpSkillPolicyForTool(ctx, toolName)
	if err != nil {
		return false, "skill policy could not be loaded", def, policy
	}
	if !found {
		return true, "", def, policy
	}
	if !policy.Enabled {
		return false, fmt.Sprintf("skill %s is disabled", def.Name), def, policy
	}
	// Skill store controls feature availability (enabled/disabled) globally.
	// Agent access level guardrails are enforced separately by tool risk policies.
	_ = securityLevel
	return true, "", def, policy
}

func (h *Handler) incrementMCPSkillUsage(ctx context.Context, toolName string) {
	def, ok := mcpSkillDefinitionForTool(toolName)
	if !ok {
		return
	}
	if err := h.ensureMCPSkillStoreLoaded(ctx); err != nil {
		return
	}

	mcpSkillStore.mu.Lock()
	mcpSkillStore.usage[def.ID] = mcpSkillStore.usage[def.ID] + 1
	mcpSkillStore.mu.Unlock()
}

func mcpSkillForTool(toolName string) (string, string, bool) {
	def, ok := mcpSkillDefinitionForTool(toolName)
	if !ok {
		return "", "", false
	}
	return def.Name, def.Icon, true
}

// ListMCPSkills handles GET /api/project/mcp/skills
func (h *Handler) ListMCPSkills(c echo.Context) error {
	ctx := c.Request().Context()
	items, err := h.mcpSkillStoreSnapshot(ctx)
	if err != nil {
		return c.JSON(500, map[string]string{"error": "failed to load mcp skills"})
	}
	return c.JSON(200, map[string]any{
		"items":         items,
		"level_options": []string{mcpSecurityLevelLibre, mcpSecurityLevelMedio, mcpSecurityLevelRestringido},
	})
}

// UpdateMCPSkill handles POST /api/project/mcp/skills/action
func (h *Handler) UpdateMCPSkill(c echo.Context) error {
	ctx := c.Request().Context()

	var req mcpSkillStoreUpdateRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(400, map[string]string{"error": "invalid skill payload"})
	}
	req.SkillID = strings.TrimSpace(req.SkillID)
	if req.SkillID == "" {
		return c.JSON(400, map[string]string{"error": "skill_id is required"})
	}

	if err := h.ensureMCPSkillStoreLoaded(ctx); err != nil {
		return c.JSON(500, map[string]string{"error": "failed to initialize skill store"})
	}

	mcpSkillStore.mu.Lock()
	baseDef, ok := mcpSkillDefinitionByID[req.SkillID]
	if !ok {
		mcpSkillStore.mu.Unlock()
		return c.JSON(404, map[string]string{"error": "skill not found"})
	}
	current := normalizeMCPSkillPolicy(mcpSkillStore.policies[req.SkillID], mcpSkillPolicy{
		Enabled:  baseDef.DefaultEnabled,
		MinLevel: baseDef.DefaultMinLevel,
	})
	if req.Enabled != nil {
		current.Enabled = *req.Enabled
	}
	if req.MinLevel != nil {
		current.MinLevel = normalizeMCPSecurityLevel(*req.MinLevel)
	}
	mcpSkillStore.policies[req.SkillID] = current
	policiesCopy := make(map[string]mcpSkillPolicy, len(mcpSkillStore.policies))
	for skillID, policy := range mcpSkillStore.policies {
		policiesCopy[skillID] = policy
	}
	usageCount := mcpSkillStore.usage[req.SkillID]
	mcpSkillStore.mu.Unlock()

	if err := h.persistMCPSkillPolicies(ctx, policiesCopy); err != nil {
		return c.JSON(500, map[string]string{"error": "failed to persist skill policy"})
	}

	now := time.Now().UTC()
	globalMCPStreamBroker.Publish(mcpStreamEvent{
		EventType:       "skill_status_changed",
		Event:           "skill_status_changed",
		SkillID:         baseDef.ID,
		SkillName:       baseDef.Name,
		Icon:            baseDef.Icon,
		Enabled:         &current.Enabled,
		MinLevel:        current.MinLevel,
		ActivityKind:    mcpActivityKindAuth,
		PipelineFX:      mcpPipelineFXShield,
		TargetResource:  baseDef.ID,
		OperationDetail: "UPDATE GOVERNANCE",
		StatusMsg:       "skill governance policy was updated.",
		Timestamp:       now,
	})

	return c.JSON(200, map[string]any{
		"skill": mcpSkillStoreItem{
			ID:          baseDef.ID,
			Name:        baseDef.Name,
			Description: baseDef.Description,
			Icon:        baseDef.Icon,
			Enabled:     current.Enabled,
			MinLevel:    current.MinLevel,
			UsageCount:  usageCount,
			Tools:       append([]string{}, baseDef.Tools...),
		},
	})
}
