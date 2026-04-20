package cli

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type mcpRPCRequest struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
}

// handleMCP handles CLI-only MCP helpers that do not require starting the full API server.
//
// Usage:
//
//	ozybase mcp bridge --url https://project.example.com/api/project/mcp
//
// The command implements an STDIO <-> HTTP JSON-RPC bridge:
//   - Reads one JSON-RPC message per line from stdin.
//   - Forwards requests to the configured MCP URL via POST.
//   - Writes one JSON-RPC response per line to stdout.
func handleMCP(args []string) error {
	if len(args) == 0 || args[0] != "bridge" {
		return errors.New("usage: ozybase mcp bridge --url <https://.../api/project/mcp> [--header apikey] [--api-key <key>]")
	}

	fs := flag.NewFlagSet("mcp bridge", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)

	serverURL := fs.String("url", "", "Remote MCP endpoint URL (e.g. https://.../api/project/mcp)")
	headerName := fs.String("header", "apikey", "Authentication header name")
	apiKeyFlag := fs.String("api-key", "", "Authentication key (prefer OZYBASE_API_KEY env var)")
	clientName := fs.String("client-name", "OzyBaseMCPBridge/1.0", "Client name header value")
	timeoutSeconds := fs.Int("timeout", 60, "HTTP timeout in seconds")
	installSkills := fs.Bool("install-skills", false, "Scaffold a local skills directory in the current path")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}

	if *installSkills {
		if err := scaffoldSkills(); err != nil {
			fmt.Fprintf(os.Stderr, "⚠️  Warning: Failed to scaffold skills: %v\n", err)
		} else {
			fmt.Fprintf(os.Stderr, "✅ Local skills scaffolded successfully in .agents/skills\n")
		}
	}

	url := strings.TrimSpace(*serverURL)
	if url == "" {
		return errors.New("missing --url for mcp bridge")
	}
	header := strings.TrimSpace(*headerName)
	if header == "" {
		header = "apikey"
	}
	apiKey := strings.TrimSpace(*apiKeyFlag)
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("OZYBASE_API_KEY"))
	}
	if apiKey == "" {
		return errors.New("missing api key: set --api-key or OZYBASE_API_KEY")
	}

	httpClient := &http.Client{
		Timeout: time.Duration(*timeoutSeconds) * time.Second,
	}

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var req mcpRPCRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			continue
		}
		if strings.HasPrefix(req.Method, "notifications/") {
			continue
		}

		responsePayload, err := forwardMCPRPC(httpClient, url, header, apiKey, strings.TrimSpace(*clientName), []byte(line), req.ID)
		if err != nil {
			responsePayload = buildJSONRPCError(req.ID, -32603, err.Error())
		}

		if _, err := os.Stdout.Write(responsePayload); err != nil {
			return err
		}
		if _, err := os.Stdout.WriteString("\n"); err != nil {
			return err
		}
	}

	if err := scanner.Err(); err != nil {
		return err
	}
	return nil
}

func forwardMCPRPC(client *http.Client, url, authHeader, authValue, clientName string, payload []byte, id json.RawMessage) ([]byte, error) {
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set(authHeader, authValue)
	if clientName != "" {
		req.Header.Set("X-Client-Name", clientName)
	}

	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bridge connection error: %w", err)
	}
	defer res.Body.Close()

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}

	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		if res.StatusCode >= http.StatusBadRequest {
			return buildJSONRPCError(id, -32603, fmt.Sprintf("server returned %d with empty body", res.StatusCode)), nil
		}
		return buildJSONRPCError(id, -32603, "empty response from server"), nil
	}

	if !json.Valid(trimmed) {
		if res.StatusCode >= http.StatusBadRequest {
			return buildJSONRPCError(id, -32603, fmt.Sprintf("server returned %d: %s", res.StatusCode, string(trimmed))), nil
		}
		return buildJSONRPCError(id, -32603, "invalid JSON response from server"), nil
	}

	return trimmed, nil
}

func buildJSONRPCError(id json.RawMessage, code int, message string) []byte {
	var parsedID any = nil
	if len(bytes.TrimSpace(id)) > 0 {
		_ = json.Unmarshal(id, &parsedID)
	}

	payload, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      parsedID,
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	})
	return payload
}

func scaffoldSkills() error {
	path := ".agents/skills"
	if err := os.MkdirAll(path, 0755); err != nil {
		return err
	}

	// Create package.json for NPM compatibility
	pkgJSON := `{
  "name": "ozybase-skills",
  "version": "1.0.0",
  "description": "OzyBase MCP Skills",
  "private": true,
  "dependencies": {}
}`
	_ = os.WriteFile(path+"/package.json", []byte(pkgJSON), 0644)

	// Create a sample skill if directory is empty
	files, err := os.ReadDir(path)
	if err == nil && len(files) <= 1 { // Only package.json or empty
		sampleSkill := `{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "A sample skill to get you started.",
  "permissions": ["neural_access"],
  "main": "index.js"
}`
		_ = os.WriteFile(path+"/hello-world.json", []byte(sampleSkill), 0644)
	}

	return nil
}
