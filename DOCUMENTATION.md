# 🚀 OzyBase Documentation

Welcome to **OzyBase**, the high-performance, open-source Backend-as-a-Service (BaaS) powered by embedded PostgreSQL and Go.

---

## 🔑 1. API Keys & Authentication Architecture

OzyBase provides a 3-tier key security system designed for both client-side and server-side operations:

| Key Type | Header Format | Intended Usage | Permissions & Access |
| :--- | :--- | :--- | :--- |
| **Anon Key** | `apikey: <ANON_KEY>` or `Authorization: Bearer <ANON_KEY>` | Frontend web apps, Mobile apps, SPA | Public API access, restricted by RLS (Row Level Security) policies and collection rules. |
| **Service Role Key** | `apikey: <SERVICE_ROLE_KEY>` or `Authorization: Bearer <SERVICE_ROLE_KEY>` | Server-side backends (Node.js, Go, Python), Cron jobs | **Super Admin bypass**. Bypasses RLS, full execution of raw SQL (`/api/sql`), collection schema management, and admin REST endpoints. |
| **MCP Token** | `Authorization: Bearer <MCP_TOKEN>` | Cursor, VSCode, Claude AI agent integrations | Full AI agent environment control via Model Context Protocol JSON-RPC. |

---

## 🌐 2. Standard REST API (`/rest/v1/*`)

OzyBase exposes a Supabase & PostgREST compatible REST API under `/rest/v1`.

### Endpoints Overview

- **`GET /rest/v1/:table`**: Query records from a table.
- **`POST /rest/v1/:table`**: Insert a new record into a table.
- **`GET /rest/v1/:table/:id`**: Retrieve a single record by ID.
- **`PATCH /rest/v1/:table/:id`**: Update an existing record by ID.
- **`DELETE /rest/v1/:table/:id`**: Delete a record by ID.
- **`POST /rest/v1/rpc/:function`**: Invoke an Edge Function or SQL procedure.

### Query Parameters & Filtering

| Parameter | Example | Description |
| :--- | :--- | :--- |
| `limit` | `?limit=25` | Maximum number of rows to return (default: 100, max: 1000). |
| `offset` | `?offset=50` | Row offset for pagination. |
| `order` | `?order=created_at.desc` | Sort field and direction (`asc` or `desc`). |
| `select` | `?select=id,name,email` | Filter columns to return in output. |

---

## 🛠️ 3. Native Migrations & Schema as Code

OzyBase supports versioned SQL file migrations located in the `./migrations` directory.

### Creating a Migration

```powershell
.\ozybase.exe migrate create add_users_table
```
*Generates `./migrations/20260727120000_add_users_table.sql`.*

### Applying Migrations

- **Automatic:** OzyBase automatically checks and applies pending `.sql` files upon server startup.
- **Manual CLI:**
  ```powershell
  .\ozybase.exe migrate apply
  ```

### TypeScript Type Generation

To keep your frontend code strictly typed with your PostgreSQL schema:
```powershell
.\ozybase.exe gen-types --out ./OzyBase-types.ts
```

---

## ⚡ 4. Realtime WebSockets

Realtime events can be enabled per table via the Dashboard or via MCP tool `realtime.toggle`:

```json
{
  "table": "messages",
  "enabled": true
}
```

Connect via WebSocket to subscribe to live DML events (`INSERT`, `UPDATE`, `DELETE`):
`ws://localhost:8090/api/realtime`

---

## 📦 5. Storage & Edge Functions

- **Storage API:** `/api/files/buckets`
- **Edge Functions:** `/api/functions` (Deploy JS/WASM handlers that respond to HTTP or DB triggers).
