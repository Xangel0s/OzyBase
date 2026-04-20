# OzyBase MCP in VS Code / Cursor / Antigravity

## Where to find it in OzyBase

Open:

`Settings > API Keys > MCP Gateway`

Reveal the active `service_role` key. That panel now shows:

- the MCP server URL
- copyable JSON-RPC test commands
- ready-to-paste snippets for both `servers` and `mcpServers`

## VS Code configuration (`servers`, STDIO)

Add this to `.vscode/mcp.json` in your workspace, or to your user MCP configuration:

```json
{
  "servers": {
    "ozybase": {
      "command": "ozybase",
      "args": [
        "mcp",
        "bridge",
        "--url",
        "https://YOUR_DOMAIN/api/project/mcp"
      ],
      "env": {
        "OZYBASE_API_KEY": "YOUR_SERVICE_ROLE_KEY"
      }
    }
  }
}
```

## What this endpoint supports

OzyBase currently exposes these MCP methods:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`

Current built-in tools:

- `system.health`
- `collections.list`
- `collections.create`
- `vector.status`
- `nlq.translate`
- `nlq.query`

## Transport note

OzyBase still keeps the original native HTTP helper endpoints:

- `GET /api/project/mcp/tools`
- `POST /api/project/mcp/invoke`

Those are useful for direct scripts and diagnostics.

For MCP-aware editors such as VS Code, prefer:

- `POST /api/project/mcp`

## Cursor / Antigravity configuration (`mcpServers`, STDIO)

Some MCP hosts expect `mcpServers` instead of `servers`. Use this variant in those clients:

```json
{
  "mcpServers": {
    "ozybase": {
      "command": "ozybase",
      "args": [
        "mcp",
        "bridge",
        "--url",
        "https://YOUR_DOMAIN/api/project/mcp"
      ],
      "env": {
        "OZYBASE_API_KEY": "YOUR_SERVICE_ROLE_KEY"
      }
    }
  }
}
```

## Why STDIO by default

- Matches modern editor MCP patterns (`command` + `args`).
- Avoids keeping `ozy_bridge.js` files in each workspace.
- Keeps transport handling encapsulated in the MCP module.

> If `ozybase` is not in your PATH, set `command` to the full binary path (for example `C:\\path\\to\\ozybase.exe`).

## Security note

Use only the `service_role` key for MCP admin automation.

Do not place that key in:

- browser code
- mobile apps
- public repos
- client-side environment files
