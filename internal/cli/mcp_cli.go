package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func handleMcp(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: ozybase mcp <config|status|connect> [--url http://localhost:8090/api/project/mcp]")
	}

	subCmd := strings.ToLower(strings.TrimSpace(args[0]))
	fs := flag.NewFlagSet("mcp "+subCmd, flag.ContinueOnError)
	fs.SetOutput(os.Stdout)

	targetURL := fs.String("url", "http://localhost:8090/api/project/mcp", "Target OzyBase MCP endpoint URL")
	outPath := fs.String("out", "", "Output file for Cursor/VS Code config (e.g. .cursor/mcp.json)")

	if err := fs.Parse(args[1:]); err != nil {
		return err
	}

	switch subCmd {
	case "config":
		return generateMcpConfig(*targetURL, *outPath)
	case "status":
		return checkMcpStatus(*targetURL)
	case "connect":
		return printMcpConnectInstructions(*targetURL)
	default:
		return fmt.Errorf("unknown mcp command %q. Available: config, status, connect", subCmd)
	}
}

func generateMcpConfig(targetURL string, outPath string) error {
	configMap := map[string]any{
		"mcpServers": map[string]any{
			"ozybase": map[string]any{
				"url": targetURL,
			},
		},
	}

	jsonBytes, err := json.MarshalIndent(configMap, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal mcp config: %w", err)
	}

	if strings.TrimSpace(outPath) != "" {
		dir := filepath.Dir(outPath)
		if dir != "." && dir != "" {
			_ = os.MkdirAll(dir, 0o755)
		}
		if err := os.WriteFile(outPath, jsonBytes, 0o644); err != nil {
			return fmt.Errorf("failed to write mcp config file: %w", err)
		}
		fmt.Printf("[OK] MCP configuration saved to %s\n", outPath)
		return nil
	}

	fmt.Println("OzyBase MCP Configuration Snippet (copy to .cursor/mcp.json or VS Code settings):")
	fmt.Println(string(jsonBytes))
	return nil
}

func checkMcpStatus(targetURL string) error {
	reqBody := map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
	}
	b, _ := json.Marshal(reqBody)

	fmt.Printf("[INFO] Testing MCP endpoint at %s...\n", targetURL)
	resp, err := http.Post(targetURL, "application/json", bytes.NewBuffer(b))
	if err != nil {
		return fmt.Errorf("[ERROR] Failed to reach MCP endpoint: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		fmt.Printf("[WARN] MCP Endpoint responded with HTTP %d: %s\n", resp.StatusCode, string(bodyBytes))
		return nil
	}

	fmt.Printf("[OK] OzyBase MCP Endpoint is LIVE and responsive (HTTP 200).\n")
	fmt.Printf("Response: %s\n", string(bodyBytes))
	return nil
}

func printMcpConnectInstructions(targetURL string) error {
	fmt.Println("==================================================")
	fmt.Println("OZYBASE MCP AUTO-CONFIGURATOR")
	fmt.Println("==================================================")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}
	if targetURL == "http://localhost:8090/api/project/mcp" && port != "8090" {
		targetURL = fmt.Sprintf("http://localhost:%s/api/project/mcp", port)
	}

	fmt.Printf("[INFO] Target MCP Endpoint: %s\n\n", targetURL)

	// Auto-create workspace configuration files
	errCursor := generateMcpConfig(targetURL, ".cursor/mcp.json")
	errVscode := generateMcpConfig(targetURL, ".vscode/mcp.json")

	if errCursor == nil || errVscode == nil {
		fmt.Println("\n✨ [SUCCESS] MCP auto-configured for your IDE!")
		fmt.Println("Created/updated .cursor/mcp.json & .vscode/mcp.json automatically.")
		fmt.Println("Reload your IDE or MCP servers to start using OzyBase MCP tools.")
	} else {
		fmt.Println("\nTo connect manually in Cursor, Windsurf, or VS Code:")
		fmt.Printf("   MCP Server URL: %s\n", targetURL)
	}
	fmt.Println("==================================================")
	return nil
}
