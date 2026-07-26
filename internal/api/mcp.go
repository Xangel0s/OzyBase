package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// MCPRequest represents a JSON-RPC request from the client
type MCPRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// MCPResponse represents a JSON-RPC response to the client
type MCPResponse struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id"`
	Result  any    `json:"result,omitempty"`
	Error   any    `json:"error,omitempty"`
}

// MCPError represents a JSON-RPC error
type MCPError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// DeviceRequest represents a pending or completed device connection flow
type DeviceRequest struct {
	DeviceCode    string
	UserCode      string
	WorkspacePath string
	Client        string
	Editor        string
	SecurityLevel string
	Status        string // "pending", "approved", "rejected", "expired"
	McpToken      string
	TokenPrefix   string
	APIKeyID      string
	ExpiresAt     time.Time
}

var (
	deviceRequestsMu sync.Mutex
	deviceRequests   = make(map[string]*DeviceRequest) // keyed by device_code
	userCodes        = make(map[string]*DeviceRequest) // keyed by user_code
)

func generateRandomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func generateUserCode() string {
	const letters = "ABCDEFGHJKLMNOPQRSTUVWXYZ23456789"
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = letters[b[i]%byte(len(letters))]
	}
	return string(b[:4]) + "-" + string(b[4:])
}

// StartMcpDeviceFlow handles POST /api/project/mcp/device/start
func (h *Handler) StartMcpDeviceFlow(c echo.Context) error {
	var req struct {
		WorkspacePath   string   `json:"workspace_path"`
		McpURL          string   `json:"mcp_url"`
		DashboardURL    string   `json:"dashboard_url"`
		Client          string   `json:"client"`
		Editor          string   `json:"editor"`
		SecurityLevel   string   `json:"security_level"`
		RequestedScopes []string `json:"requested_scopes"`
	}

	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	deviceCode := "dev_" + generateRandomHex(16)
	userCode := generateUserCode()
	
	verificationURI := fmt.Sprintf("%s/api/project/mcp/device/approve?user_code=%s", resolveProjectAPIURL(c), userCode)

	deviceRequestsMu.Lock()
	request := &DeviceRequest{
		DeviceCode:    deviceCode,
		UserCode:      userCode,
		WorkspacePath: req.WorkspacePath,
		Client:        req.Client,
		Editor:        req.Editor,
		SecurityLevel: req.SecurityLevel,
		Status:        "pending",
		ExpiresAt:     time.Now().Add(10 * time.Minute),
	}
	deviceRequests[deviceCode] = request
	userCodes[userCode] = request
	deviceRequestsMu.Unlock()

	return c.JSON(http.StatusOK, map[string]any{
		"device_code":      deviceCode,
		"user_code":        userCode,
		"verification_uri": verificationURI,
		"expires_in":       600,
		"interval":         2,
	})
}

// GetApproveMcpDevice handles GET /api/project/mcp/device/approve
func (h *Handler) GetApproveMcpDevice(c echo.Context) error {
	userCode := strings.TrimSpace(c.QueryParam("user_code"))
	if userCode == "" {
		return c.HTML(http.StatusBadRequest, `<h1>Error</h1><p>Missing user_code parameter</p>`)
	}

	deviceRequestsMu.Lock()
	req, exists := userCodes[userCode]
	deviceRequestsMu.Unlock()

	if !exists || time.Now().After(req.ExpiresAt) {
		return c.HTML(http.StatusNotFound, `
			<!DOCTYPE html>
			<html>
			<head>
				<title>OzyBase MCP Authorization</title>
				<style>
					body { background: #09090b; color: #fafafa; font-family: sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; }
					.card { border: 1px solid #27272a; padding: 2rem; border-radius: 8px; text-align: center; }
					h1 { color: #ef4444; }
				</style>
			</head>
			<body>
				<div class="card">
					<h1>Expired or Invalid Code</h1>
					<p>This authorization code is invalid or has expired. Please restart the connection flow in your terminal.</p>
				</div>
			</body>
			</html>
		`)
	}

	html := fmt.Sprintf(`
		<!DOCTYPE html>
		<html>
		<head>
			<title>Authorize MCP Device - OzyBase</title>
			<style>
				:root {
					--color-bg: #09090b;
					--color-card: #151515;
					--color-border: #27272a;
					--color-text: #fafafa;
					--color-muted: #a1a1aa;
					--color-primary: #d2f20b;
					--color-primary-hover: #bce009;
				}
				body {
					background-color: var(--color-bg);
					color: var(--color-text);
					font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
					display: grid;
					place-items: center;
					min-height: 100vh;
					margin: 0;
					padding: 16px;
				}
				.card {
					background-color: var(--color-card);
					border: 1px solid var(--color-border);
					border-radius: 16px;
					width: 100%%;
					max-width: 480px;
					padding: 32px;
					box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
					box-sizing: border-box;
				}
				h1 {
					font-size: 24px;
					font-weight: 700;
					margin: 0 0 8px 0;
					text-align: center;
				}
				.subtitle {
					color: var(--color-muted);
					font-size: 14px;
					text-align: center;
					margin-bottom: 24px;
				}
				.details {
					border: 1px solid var(--color-border);
					background-color: rgba(255, 255, 255, 0.02);
					border-radius: 8px;
					padding: 16px;
					margin-bottom: 24px;
					font-size: 14px;
				}
				.details-row {
					display: flex;
					justify-content: space-between;
					margin-bottom: 10px;
				}
				.details-row:last-child {
					margin-bottom: 0;
				}
				.label {
					color: var(--color-muted);
				}
				.value {
					font-weight: 500;
					font-family: monospace;
				}
				.code-display {
					font-size: 28px;
					font-weight: 700;
					letter-spacing: 2px;
					text-align: center;
					color: var(--color-primary);
					margin: 24px 0;
					font-family: monospace;
				}
				button {
					background-color: var(--color-primary);
					color: #000;
					border: none;
					border-radius: 8px;
					padding: 12px 24px;
					font-size: 14px;
					font-weight: 600;
					width: 100%%;
					cursor: pointer;
					transition: background-color 0.2s;
				}
				button:hover {
					background-color: var(--color-primary-hover);
				}
			</style>
		</head>
		<body>
			<div class="card">
				<h1>Authorize MCP Connection</h1>
				<div class="subtitle">An external client is requesting access to OzyBase</div>
				
				<div class="code-display">%s</div>

				<div class="details">
					<div class="details-row">
						<span class="label">Client:</span>
						<span class="value">%s</span>
					</div>
					<div class="details-row">
						<span class="label">Editor:</span>
						<span class="value">%s</span>
					</div>
					<div class="details-row">
						<span class="label">Workspace:</span>
						<span class="value">%s</span>
					</div>
					<div class="details-row">
						<span class="label">Security Level:</span>
						<span class="value">%s</span>
					</div>
				</div>

				<form action="/api/project/mcp/device/approve/confirm" method="POST">
					<input type="hidden" name="user_code" value="%s" />
					<button type="submit">Approve Connection</button>
				</form>
			</div>
		</body>
		</html>
	`, userCode, req.Client, req.Editor, req.WorkspacePath, req.SecurityLevel, userCode)

	return c.HTML(http.StatusOK, html)
}

// ConfirmMcpDeviceApproval handles POST /api/project/mcp/device/approve/confirm
func (h *Handler) ConfirmMcpDeviceApproval(c echo.Context) error {
	userCode := strings.TrimSpace(c.FormValue("user_code"))
	if userCode == "" {
		return c.HTML(http.StatusBadRequest, `<h1>Error</h1><p>Missing user_code</p>`)
	}

	deviceRequestsMu.Lock()
	req, exists := userCodes[userCode]
	deviceRequestsMu.Unlock()

	if !exists || time.Now().After(req.ExpiresAt) {
		return c.HTML(http.StatusNotFound, `<h1>Expired</h1><p>Request has expired or is invalid</p>`)
	}

	ctx := c.Request().Context()
	
	rawKey, err := GenerateRandomKey()
	if err != nil {
		return c.HTML(http.StatusInternalServerError, `<h1>Error</h1><p>Failed to generate API key</p>`)
	}
	prefix := "ozy_" + rawKey[:4]
	fullKey := fmt.Sprintf("%s_%s", prefix, rawKey)
	hash := sha256.Sum256([]byte(fullKey))
	keyHash := hex.EncodeToString(hash[:])

	var workspaceID string
	err = h.DB.Pool.QueryRow(ctx, "SELECT id::text FROM _v_workspaces LIMIT 1").Scan(&workspaceID)
	if err != nil {
		workspaceID = ""
	}

	apiKeyID := uuid.New().String()
	name := fmt.Sprintf("MCP (%s - %s)", req.Client, req.Editor)

	var workspaceVal any
	if workspaceID != "" {
		workspaceVal = workspaceID
	}
	
	_, err = h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_api_keys (id, name, key_hash, prefix, role, is_active, workspace_id)
		VALUES ($1, $2, $3, $4, $5, true, $6)
	`, apiKeyID, name, keyHash, prefix, "service_role", workspaceVal)

	if err != nil {
		return c.HTML(http.StatusInternalServerError, fmt.Sprintf(`<h1>Error</h1><p>Failed to store API key: %v</p>`, err))
	}

	deviceRequestsMu.Lock()
	req.Status = "approved"
	req.McpToken = fullKey
	req.TokenPrefix = prefix
	req.APIKeyID = apiKeyID
	deviceRequestsMu.Unlock()

	html := `
		<!DOCTYPE html>
		<html>
		<head>
			<title>Connection Approved - OzyBase</title>
			<style>
				body { background: #09090b; color: #fafafa; font-family: sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; }
				.card { border: 1px solid #27272a; padding: 2.5rem; border-radius: 12px; text-align: center; max-width: 400px; background: #151515; }
				h1 { color: #d2f20b; margin-top: 0; }
				p { color: #a1a1aa; line-height: 1.5; }
			</style>
		</head>
		<body>
			<div class="card">
				<h1>✓ Approved</h1>
				<p>The MCP connection was successfully approved. You can close this tab and return to your terminal.</p>
			</div>
		</body>
		</html>
	`
	return c.HTML(http.StatusOK, html)
}

// GetMcpDeviceStatus handles GET /api/project/mcp/device/status
func (h *Handler) GetMcpDeviceStatus(c echo.Context) error {
	deviceCode := strings.TrimSpace(c.QueryParam("device_code"))
	if deviceCode == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Missing device_code"})
	}

	deviceRequestsMu.Lock()
	req, exists := deviceRequests[deviceCode]
	deviceRequestsMu.Unlock()

	if !exists {
		return c.JSON(http.StatusNotFound, map[string]string{"status": "expired"})
	}

	if time.Now().After(req.ExpiresAt) {
		return c.JSON(http.StatusOK, map[string]string{"status": "expired"})
	}

	if req.Status == "approved" {
		return c.JSON(http.StatusOK, map[string]any{
			"status":       "approved",
			"mcp_token":    req.McpToken,
			"token_prefix": req.TokenPrefix,
			"api_key_id":   req.APIKeyID,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "authorization_pending"})
}

// HandleMcpJsonRpc handles POST /api/project/mcp
func (h *Handler) HandleMcpJsonRpc(c echo.Context) error {
	var req MCPRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]any{
			"jsonrpc": "2.0",
			"error": map[string]any{
				"code":    -32700,
				"message": "Parse error",
			},
		})
	}

	resp := MCPResponse{
		JSONRPC: "2.0",
		ID:      req.ID,
	}

	switch req.Method {
	case "initialize":
		resp.Result = map[string]any{
			"protocolVersion": "2025-06-18",
			"capabilities": map[string]any{
				"tools": map[string]any{},
			},
			"serverInfo": map[string]any{
				"name":    "OzyBase",
				"version": "1.0.0",
			},
		}
		return c.JSON(http.StatusOK, resp)

	case "tools/list":
		resp.Result = map[string]any{
			"tools": []map[string]any{
				{
					"name":        "system.health",
					"description": "Get OzyBase system health, database connection, and uptime status",
					"inputSchema": map[string]any{
						"type":       "object",
						"properties": map[string]any{},
					},
				},
				{
					"name":        "sql.query",
					"description": "Execute a SQL query on the PostgreSQL database",
					"inputSchema": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"query": map[string]any{
								"type":        "string",
								"description": "The SQL query to execute",
							},
						},
						"required": []string{"query"},
					},
				},
				{
					"name":        "storage.create_bucket",
					"description": "Create a new storage bucket in OzyBase",
					"inputSchema": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"name": map[string]any{
								"type":        "string",
								"description": "The bucket name (unique)",
							},
							"public": map[string]any{
								"type":        "boolean",
								"description": "Whether the bucket is publicly readable",
							},
						},
						"required": []string{"name"},
					},
				},
				{
					"name":        "functions.deploy",
					"description": "Deploy or create an edge function in OzyBase",
					"inputSchema": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"name": map[string]any{
								"type":        "string",
								"description": "The function name",
							},
							"script": map[string]any{
								"type":        "string",
								"description": "The JavaScript or Go code script for the function",
							},
							"runtime": map[string]any{
								"type":        "string",
								"description": "Runtime environment (e.g. 'js', 'wasm')",
							},
						},
						"required": []string{"name", "script"},
					},
				},
			},
		}
		return c.JSON(http.StatusOK, resp)

	case "tools/call":
		var callParams struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &callParams); err != nil {
			resp.Error = &MCPError{
				Code:    -32602,
				Message: "Invalid params",
			}
			return c.JSON(http.StatusOK, resp)
		}

		ctx := c.Request().Context()
		switch callParams.Name {
		case "system.health":
			dbStatus := "Connected"
			if err := h.DB.Health(ctx); err != nil {
				dbStatus = "Disconnected: " + err.Error()
			}
			healthText := fmt.Sprintf("OzyBase is healthy. Database: %s. Uptime: %s.", dbStatus, time.Since(startTime).String())
			resp.Result = map[string]any{
				"content": []map[string]any{
					{
						"type": "text",
						"text": healthText,
					},
				},
			}
			return c.JSON(http.StatusOK, resp)

		case "sql.query":
			var queryArgs struct {
				Query string `json:"query"`
			}
			if err := json.Unmarshal(callParams.Arguments, &queryArgs); err != nil {
				resp.Error = &MCPError{
					Code:    -32602,
					Message: "Invalid arguments, expected 'query' string",
				}
				return c.JSON(http.StatusOK, resp)
			}

			rows, err := h.DB.Pool.Query(ctx, queryArgs.Query)
			if err != nil {
				resp.Result = map[string]any{
					"content": []map[string]any{
						{
							"type": "text",
							"text": fmt.Sprintf("Query error: %v", err),
						},
					},
					"isError": true,
				}
				return c.JSON(http.StatusOK, resp)
			}
			defer rows.Close()

			fieldDescriptions := rows.FieldDescriptions()
			cols := make([]string, len(fieldDescriptions))
			for i, fd := range fieldDescriptions {
				cols[i] = string(fd.Name)
			}

			var results []map[string]any
			for rows.Next() {
				values, err := rows.Values()
				if err != nil {
					continue
				}
				rowMap := make(map[string]any)
				for i, val := range values {
					switch v := val.(type) {
					case []byte:
						rowMap[cols[i]] = string(v)
					default:
						rowMap[cols[i]] = v
					}
				}
				results = append(results, rowMap)
			}

			if err := rows.Err(); err != nil {
				resp.Result = map[string]any{
					"content": []map[string]any{
						{
							"type": "text",
							"text": fmt.Sprintf("Error reading rows: %v", err),
						},
					},
					"isError": true,
				}
				return c.JSON(http.StatusOK, resp)
			}

			if results == nil {
				results = []map[string]any{}
			}

			jsonBytes, _ := json.Marshal(results)
			if results == nil {
				jsonBytes = []byte("[]")
			}

			upper := strings.ToUpper(queryArgs.Query)
			if strings.Contains(upper, "CREATE TABLE") || strings.Contains(upper, "ALTER TABLE") || strings.Contains(upper, "DROP TABLE") {
				h.invalidateProjectInfoCache()
				h.invalidateHealthIssuesCache()
				workspaceID, _ := c.Get("workspace_id").(string)
				if userTables, tblErr := h.DB.ListTables(ctx); tblErr == nil {
					for _, tName := range userTables {
						_ = h.upsertCollectionMetadataForTable(ctx, tName, workspaceID)
					}
				}
			}

			resp.Result = map[string]any{
				"content": []map[string]any{
					{
						"type": "text",
						"text": string(jsonBytes),
					},
				},
			}
			return c.JSON(http.StatusOK, resp)

		case "storage.create_bucket":
			var bucketArgs struct {
				Name   string `json:"name"`
				Public bool   `json:"public"`
			}
			if err := json.Unmarshal(callParams.Arguments, &bucketArgs); err != nil || strings.TrimSpace(bucketArgs.Name) == "" {
				resp.Error = &MCPError{Code: -32602, Message: "Invalid arguments, expected 'name' string"}
				return c.JSON(http.StatusOK, resp)
			}
			_, err := h.DB.Pool.Exec(ctx, `
				INSERT INTO _v_buckets (name, public, rls_enabled, rls_rule, max_file_size_bytes, max_total_size_bytes, lifecycle_delete_after_days)
				VALUES ($1, $2, true, 'public', 52428800, 5368709120, 0)
				ON CONFLICT (name) DO UPDATE SET public = EXCLUDED.public
			`, strings.TrimSpace(bucketArgs.Name), bucketArgs.Public)
			if err != nil {
				resp.Result = map[string]any{"content": []map[string]any{{"type": "text", "text": fmt.Sprintf("Error creating bucket: %v", err)}}, "isError": true}
				return c.JSON(http.StatusOK, resp)
			}
			h.invalidateProjectInfoCache()
			resp.Result = map[string]any{"content": []map[string]any{{"type": "text", "text": fmt.Sprintf("Bucket '%s' created successfully.", bucketArgs.Name)}}}
			return c.JSON(http.StatusOK, resp)

		case "functions.deploy":
			var fnArgs struct {
				Name    string `json:"name"`
				Script  string `json:"script"`
				Runtime string `json:"runtime"`
			}
			if err := json.Unmarshal(callParams.Arguments, &fnArgs); err != nil || strings.TrimSpace(fnArgs.Name) == "" || strings.TrimSpace(fnArgs.Script) == "" {
				resp.Error = &MCPError{Code: -32602, Message: "Invalid arguments, expected 'name' and 'script' strings"}
				return c.JSON(http.StatusOK, resp)
			}
			runtime := strings.TrimSpace(fnArgs.Runtime)
			if runtime == "" {
				runtime = "js"
			}
			_, err := h.DB.Pool.Exec(ctx, `
				INSERT INTO _v_functions (name, script, runtime, entrypoint, timeout_ms, updated_at)
				VALUES ($1, $2, $3, 'handler', 5000, NOW())
				ON CONFLICT (name) DO UPDATE SET script = EXCLUDED.script, runtime = EXCLUDED.runtime, updated_at = NOW()
			`, strings.TrimSpace(fnArgs.Name), fnArgs.Script, runtime)
			if err != nil {
				resp.Result = map[string]any{"content": []map[string]any{{"type": "text", "text": fmt.Sprintf("Error deploying function: %v", err)}}, "isError": true}
				return c.JSON(http.StatusOK, resp)
			}
			h.invalidateProjectInfoCache()
			resp.Result = map[string]any{"content": []map[string]any{{"type": "text", "text": fmt.Sprintf("Edge function '%s' deployed successfully.", fnArgs.Name)}}}
			return c.JSON(http.StatusOK, resp)

		default:
			resp.Error = &MCPError{
				Code:    -32601,
				Message: fmt.Sprintf("Method not found: %s", callParams.Name),
			}
			return c.JSON(http.StatusOK, resp)
		}

	default:
		resp.Error = &MCPError{
			Code:    -32601,
			Message: fmt.Sprintf("Method not found: %s", req.Method),
		}
		return c.JSON(http.StatusOK, resp)
	}
}
