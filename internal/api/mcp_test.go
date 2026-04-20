package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestNormalizeACLRule(t *testing.T) {
	allowed := map[string]struct{}{
		"public": {},
		"auth":   {},
		"admin":  {},
	}

	tests := []struct {
		name     string
		input    string
		fallback string
		want     string
		wantErr  bool
	}{
		{name: "explicit auth", input: "auth", fallback: "admin", want: "auth"},
		{name: "fallback used", input: "", fallback: "admin", want: "admin"},
		{name: "normalized uppercase", input: "PUBLIC", fallback: "auth", want: "public"},
		{name: "invalid", input: "manager", fallback: "auth", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeACLRule(tt.input, tt.fallback, allowed)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error for input %q", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("normalizeACLRule(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestMCPParseSchema(t *testing.T) {
	t.Run("valid schema", func(t *testing.T) {
		args := map[string]any{
			"schema": []any{
				map[string]any{
					"name":     "owner_id",
					"type":     "uuid",
					"required": true,
				},
				map[string]any{
					"name":   "title",
					"type":   "text",
					"unique": false,
				},
			},
		}

		fields, err := mcpParseSchema(args)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(fields) != 2 {
			t.Fatalf("expected 2 fields, got %d", len(fields))
		}
		if fields[0].Name != "owner_id" || fields[0].Type != "uuid" || !fields[0].Required {
			t.Fatalf("unexpected first field: %+v", fields[0])
		}
	})

	t.Run("missing schema", func(t *testing.T) {
		if _, err := mcpParseSchema(map[string]any{}); err == nil {
			t.Fatalf("expected error for missing schema")
		}
	})

	t.Run("invalid schema entry", func(t *testing.T) {
		args := map[string]any{
			"schema": []any{
				map[string]any{
					"name": "invalid-name",
					"type": "text",
				},
			},
		}
		if _, err := mcpParseSchema(args); err == nil {
			t.Fatalf("expected validation error for invalid identifier")
		}
	})
}

func TestHandleMCPRPCInitialize(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/project/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := &Handler{}
	if err := h.HandleMCPRPC(c); err != nil {
		t.Fatalf("HandleMCPRPC returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if payload["jsonrpc"] != "2.0" {
		t.Fatalf("expected jsonrpc 2.0, got %v", payload["jsonrpc"])
	}
	result, ok := payload["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected result object, got %T", payload["result"])
	}
	serverInfo, ok := result["serverInfo"].(map[string]any)
	if !ok || serverInfo["name"] != "OzyBase" {
		t.Fatalf("expected OzyBase serverInfo, got %+v", result["serverInfo"])
	}
}

func TestHandleMCPRPCToolsList(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/project/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := &Handler{}
	if err := h.HandleMCPRPC(c); err != nil {
		t.Fatalf("HandleMCPRPC returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	result, ok := payload["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected result object, got %T", payload["result"])
	}
	tools, ok := result["tools"].([]any)
	if !ok || len(tools) == 0 {
		t.Fatalf("expected non-empty tool list, got %+v", result["tools"])
	}

	foundAlias := false
	foundEnableRLS := false
	for _, raw := range tools {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if name, _ := item["name"].(string); name == "create_table" {
			foundAlias = true
		}
		if name, _ := item["name"].(string); name == "policies.enable_rls" {
			foundEnableRLS = true
		}
	}
	if !foundAlias {
		t.Fatalf("expected tools/list to include create_table alias")
	}
	if !foundEnableRLS {
		t.Fatalf("expected tools/list to include policies.enable_rls")
	}
}

func TestEvaluateMCPGuardrail(t *testing.T) {
	tests := []struct {
		name       string
		level      string
		tool       string
		wantAction string
	}{
		{name: "libre read tool executes", level: "libre", tool: "collections.list", wantAction: mcpGuardrailActionExecute},
		{name: "libre write tool executes", level: "libre", tool: "create_table", wantAction: mcpGuardrailActionExecute},
		{name: "medio write tool pending", level: "medio", tool: "create_table", wantAction: mcpGuardrailActionPending},
		{name: "medio dangerous tool pending", level: "medio", tool: "collections.drop", wantAction: mcpGuardrailActionPending},
		{name: "restringido write tool blocked", level: "restringido", tool: "policies.enable_rls", wantAction: mcpGuardrailActionBlocked},
		{name: "restringido dangerous tool blocked", level: "restringido", tool: "collections.delete", wantAction: mcpGuardrailActionBlocked},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := evaluateMCPGuardrail(tt.level, tt.tool)
			if got.Action != tt.wantAction {
				t.Fatalf("evaluateMCPGuardrail(%q, %q) action=%q, want %q", tt.level, tt.tool, got.Action, tt.wantAction)
			}
		})
	}
}

func TestInferEngramLLMProvider(t *testing.T) {
	tests := []struct {
		name   string
		apiKey string
		want   string
	}{
		{name: "gemini key", apiKey: "AIzaSyDUMMY1234567890", want: "gemini"},
		{name: "openai key", apiKey: "sk-test-123", want: "openai"},
		{name: "empty key", apiKey: "", want: "none"},
		{name: "unknown defaults openai", apiKey: "custom-key-format", want: "openai"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := inferEngramLLMProvider(tt.apiKey)
			if got != tt.want {
				t.Fatalf("inferEngramLLMProvider(%q)=%q want %q", tt.apiKey, got, tt.want)
			}
		})
	}
}

func TestExtractMCPClientName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		params map[string]any
		want   string
	}{
		{
			name: "clientInfo name",
			params: map[string]any{
				"clientInfo": map[string]any{"name": "Cursor"},
			},
			want: "Cursor",
		},
		{
			name: "client name fallback",
			params: map[string]any{
				"client": map[string]any{"name": "VS Code"},
			},
			want: "VS Code",
		},
		{
			name: "top level name fallback",
			params: map[string]any{
				"name": "Python CLI",
			},
			want: "Python CLI",
		},
		{
			name: "missing",
			params: map[string]any{},
			want: "",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := extractMCPClientName(tt.params); got != tt.want {
				t.Fatalf("extractMCPClientName()=%q want %q", got, tt.want)
			}
		})
	}
}

func TestBuildMCPLiveSessionKey(t *testing.T) {
	t.Parallel()

	if got := buildMCPLiveSessionKey("abc123", "", ""); got != "abc123" {
		t.Fatalf("expected base token, got %q", got)
	}

	if got := buildMCPLiveSessionKey("abc123", "MCP Agent", ""); got != "abc123" {
		t.Fatalf("expected base token for default name, got %q", got)
	}

	if got := buildMCPLiveSessionKey("abc123", "Cursor", ""); got != "abc123@cursor" {
		t.Fatalf("expected namespaced session key, got %q", got)
	}

	if got := buildMCPLiveSessionKey("abc123", "MCP Agent", "Go-http-client/1.1"); got == "abc123" {
		t.Fatalf("expected user-agent fingerprint key for generic agent, got %q", got)
	}
}

func TestNormalizeMCPClientDisplayName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		raw      string
		fallback string
		want     string
	}{
		{raw: "Visual Studio Code", fallback: "MCP Agent", want: "VSCode"},
		{raw: "GitHub Copilot", fallback: "MCP Agent", want: "VSCode"},
		{raw: "Windsurf IDE", fallback: "MCP Agent", want: "Windsurf"},
		{raw: "", fallback: "Cursor", want: "Cursor"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.want, func(t *testing.T) {
			t.Parallel()
			if got := normalizeMCPClientDisplayName(tt.raw, tt.fallback); got != tt.want {
				t.Fatalf("normalizeMCPClientDisplayName(%q, %q)=%q want %q", tt.raw, tt.fallback, got, tt.want)
			}
		})
	}
}

func TestInferMCPAgentNameModernClients(t *testing.T) {
	t.Parallel()

	tests := []struct {
		ua   string
		want string
	}{
		{ua: "Windsurf/1.2", want: "Windsurf"},
		{ua: "Cline/3.0", want: "Cline"},
		{ua: "RooCode/1.0", want: "Roo"},
		{ua: "Continue VSCode", want: "Continue"},
		{ua: "Aider/0.77", want: "Aider"},
		{ua: "JetBrains AI Assistant", want: "JetBrains"},
		{ua: "Gemini CLI", want: "Gemini"},
		{ua: "Codex CLI", want: "Codex"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.ua, func(t *testing.T) {
			t.Parallel()
			if got := inferMCPAgentName(tc.ua); got != tc.want {
				t.Fatalf("inferMCPAgentName(%q)=%q want %q", tc.ua, got, tc.want)
			}
		})
	}
}
