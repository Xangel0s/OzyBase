# OzyBase Core

<div align="center">
  <img src="https://raw.githubusercontent.com/Xangel0s/OzyBase/main/docs/banner.jpg" alt="OzyBase Banner" width="100%" />
  <br/>
  <b>Open-source BaaS with a single Go runtime, embedded dashboard, PostgreSQL data plane, AI tooling, and self-host-first deployment paths.</b>
  <br/><br/>
  <p>
    <a href="https://goreportcard.com/report/github.com/Xangel0s/OzyBase"><img src="https://img.shields.io/badge/Go%20Report-A%2B-brightgreen.svg" alt="Go Report Card"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License MIT"></a>
    <a href="./docs/DEPLOYMENT.md"><img src="https://img.shields.io/badge/Deployment-Runbook-blue.svg" alt="Deployment Runbook"></a>
    <a href="./docs/MCP_VSCODE.md"><img src="https://img.shields.io/badge/MCP-VS%20Code-purple.svg" alt="MCP VS Code"></a>
  </p>
</div>

---

## What OzyBase Is

OzyBase is a PostgreSQL-backed Backend-as-a-Service that ships as:

- a Go API server
- an embedded React dashboard
- a dynamic collections/data API
- authentication and API key management
- storage, realtime, webhooks, cron, vault, and edge functions
- security hardening, observability, integrations, and admin audit tooling
- AI-facing runtime endpoints for MCP, NLQ, and pgvector workflows

The repo is designed for self-hosting first: local binary, Docker, install-to-play, and Coolify-style managed Postgres deployments are all supported.

## What Ships Today

### 1. Setup and Bootstrap

OzyBase includes a first-run wizard with three real paths:

- `Do it myself`: creates the first admin and leaves policies/manual hardening for later
- `Secure Fortress`: creates the first admin, seeds geo-fencing from the detected country, and writes a secure bootstrap audit event
- `Migration Studio`: translates supported inputs into PostgreSQL during setup and can import the initial dataset

`Migration Studio` currently supports:

- `CSV`
- `Mongo-like JSON`
- `MySQL SQL`
- `SQLite SQL`
- `SQL Server SQL`
- `Postgres SQL`

Setup-time migration preview endpoint:

- `POST /api/system/setup/migration/preview`

## 2. Authentication and Identity

Implemented auth features include:

- email/password login
- admin-managed user creation
- password reset request/confirm flow
- email verification
- session listing, single-session revoke, and revoke-all
- TOTP-based 2FA
- OAuth entry points and callbacks
- auth provider config, auth templates, and auth settings views
- role-based user management
- CSRF token endpoint and security-header middleware

Core auth routes:

- `POST /api/auth/login`
- `POST /api/auth/signup`
- `POST /api/auth/reset-password/request`
- `POST /api/auth/reset-password/confirm`
- `GET|POST /api/auth/verify-email`
- `GET /api/auth/users`
- `PATCH /api/auth/users/:id/role`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:id`
- `POST /api/auth/sessions/revoke-all`
- `POST /api/auth/2fa/setup`
- `POST /api/auth/2fa/enable`
- `POST /api/auth/2fa/disable`
- `GET /api/auth/2fa/status`
- `POST /api/auth/2fa/verify`

## 3. Database, Collections, and Admin Data Plane

The database layer includes:

- dynamic collection creation and deletion
- schema inspection and schema visualizer
- CRUD for collection records
- table-style CRUD aliases for dashboard flows
- CSV import from the dashboard/API
- bulk row actions
- column creation and deletion
- saved table views
- realtime toggles per collection
- SQL editor execution and system sync endpoint
- GraphQL endpoint
- wrappers/extensions management for advanced PostgreSQL capabilities

Key routes:

- `POST /api/collections`
- `GET /api/collections`
- `DELETE /api/collections/:name`
- `GET /api/collections/schemas`
- `GET /api/collections/visualize`
- `PATCH /api/collections/rules`
- `PATCH /api/collections/realtime`
- `GET /api/collections/:name/records`
- `POST /api/collections/:name/records`
- `PATCH /api/collections/:name/records/:id`
- `DELETE /api/collections/:name/records/:id`
- `POST /api/tables/:name/import`
- `POST /api/sql`
- `POST /api/sql/sync`
- `POST /api/graphql/v1`

## 4. Workspaces

Workspace support is implemented for:

- workspace create/list/update/delete
- member listing
- role assignment/removal
- active workspace routing through `X-Workspace-Id`
- workspace-aware dashboard context

Current workspace scope is honest and explicit:

- memberships
- collection metadata
- API keys
- saved views
- dashboard context

Physical PostgreSQL tables, buckets, and deployment topology are still explicit and not auto-provisioned per workspace.

## 5. Storage

Storage features implemented today:

- bucket create/list/update/delete
- local filesystem storage
- S3-compatible storage
- signed upload sessions
- multipart upload sessions and part upload flow
- bucket max file size enforcement
- bucket total quota enforcement
- lifecycle deletion windows and sweep endpoint
- bucket policy inspection from the dashboard

Runtime-guaranteed ACL profiles today are:

- visibility/public-read
- owner only
- admin only
- deny all

Custom legacy expressions can still exist, but the runtime only guarantees the built-in profiles above when ACLs are edited.

Core storage routes:

- `GET /api/files/buckets`
- `POST /api/files/buckets`
- `PATCH /api/files/buckets/:name`
- `DELETE /api/files/buckets/:name`
- `POST /api/files/uploads/session`
- `POST /api/files/uploads/multipart/session`
- `PUT /api/files/uploads/multipart/:id/parts/:part`
- `POST /api/files/uploads/multipart/:id/complete`
- `DELETE /api/files/uploads/multipart/:id`
- `GET /api/files`
- `GET /api/files/:bucket/*`
- `DELETE /api/files/:bucket/*`

## 6. Functions, Automation, and Runtime Utilities

OzyBase includes:

- edge functions
- JavaScript runtime via `goja`
- WASM runtime via `wazero`
- webhook endpoints and webhook management
- cron management
- vault/secret storage
- PostgreSQL wrappers/extensions controls

Function runtimes supported today:

- `js`
- `wasm`

Core routes:

- `GET /api/functions`
- `POST /api/functions`
- `POST /api/functions/:name/invoke`
- `DELETE /api/functions/:name`
- `GET /api/webhooks`
- `POST /api/webhooks`
- `DELETE /api/webhooks/:id`
- `GET /api/cron`
- `POST /api/cron`
- `POST /api/cron/enable`
- `DELETE /api/cron/:id`
- `GET /api/vault`
- `POST /api/vault`
- `DELETE /api/vault/:id`
- `GET /api/wrappers`
- `POST /api/wrappers`
- `DELETE /api/wrappers/:name`

## 7. Realtime, Observability, and Operations

Operational/runtime features implemented:

- SSE realtime stream
- local broker plus Redis pub/sub bridge for multi-node fan-out
- realtime status endpoint
- project stats/info/connection metadata
- project health checks and guided fix/review actions
- logs and log export
- traffic and geo analytics endpoints
- Prometheus metrics endpoint
- performance advisor and advisor history
- update status endpoint
- SLO status endpoint
- storage observability endpoint
- alert routing/on-call config

Core routes:

- `GET /api/project/stats`
- `GET /api/project/info`
- `GET /api/project/connection`
- `GET /api/project/update-status`
- `GET /api/realtime`
- `GET /api/project/realtime/status`
- `GET /api/project/health`
- `POST /api/project/health/fix`
- `POST /api/project/health/review`
- `GET /api/analytics/traffic`
- `GET /api/analytics/geo`
- `GET /api/project/logs`
- `GET /api/project/logs/export`
- `GET /api/project/metrics`
- `GET /api/project/performance/advisor`
- `GET /api/project/performance/advisor/history`
- `GET /api/project/observability/slo`
- `GET /api/project/observability/storage`
- `GET /api/project/security/alert-routing`
- `POST /api/project/security/alert-routing`

## 8. Security

Security capabilities in the current codebase include:

- geo-fencing security policy
- security policy CRUD
- health-derived security alerts
- notification recipients
- firewall/IP rules
- admin audit trail
- RLS coverage inspection
- RLS mass enforcement
- RLS closeout flow
- API key creation/rotation/toggle/delete
- essential key vault with reveal/rotate/verify endpoints

Core routes:

- `GET /api/project/security/policies`
- `POST /api/project/security/policies`
- `GET /api/project/security/stats`
- `GET /api/project/security/alerts`
- `GET /api/project/security/notifications`
- `POST /api/project/security/notifications`
- `DELETE /api/project/security/notifications/:id`
- `GET /api/project/security/rls/coverage`
- `GET /api/project/security/rls/coverage/history`
- `POST /api/project/security/rls/enforce`
- `POST /api/project/security/rls/closeout`
- `GET /api/project/security/admin-audit`
- `GET /api/security/firewall`
- `POST /api/security/firewall`
- `DELETE /api/security/firewall/:id`
- `GET /api/project/keys`
- `GET /api/project/keys/essential`
- `POST /api/project/keys/essential/verify`
- `POST /api/project/keys/essential/:role/reveal`
- `POST /api/project/keys/essential/:role/rotate`

## 9. Integrations and Extensions

Implemented integration capabilities:

- project integrations list/create/delete/test
- delivery metrics
- DLQ inspection and retry
- security/integration delivery workers
- extension marketplace sync/install/uninstall

Core routes:

- `GET /api/project/integrations`
- `POST /api/project/integrations`
- `DELETE /api/project/integrations/:id`
- `POST /api/project/integrations/:id/test`
- `GET /api/project/integrations/metrics`
- `GET /api/project/integrations/dlq`
- `POST /api/project/integrations/dlq/:id/retry`
- `GET /api/extensions`
- `POST /api/extensions/:name`
- `GET /api/extensions/marketplace`
- `POST /api/extensions/marketplace/sync`
- `POST /api/extensions/marketplace/:slug/install`
- `DELETE /api/extensions/marketplace/:slug/install`

## 10. AI Runtime: MCP, NLQ, and pgvector

OzyBase exposes an AI-facing admin runtime directly over HTTP.

Implemented today:

- pgvector status/setup/upsert/search
- natural language to SQL translate/query
- MCP JSON-RPC endpoint
- MCP helper endpoints for tools listing and invoke
- VS Code remote MCP configuration support

Core routes:

- `GET /api/project/vector/status`
- `POST /api/project/vector/setup`
- `POST /api/project/vector/upsert`
- `POST /api/project/vector/search`
- `POST /api/project/nlq/translate`
- `POST /api/project/nlq/query`
- `POST /api/project/mcp`
- `GET /api/project/mcp/tools`
- `POST /api/project/mcp/invoke`

Current built-in MCP tools include:

- `system.health`
- `collections.list`
- `collections.create`
- `vector.status`
- `nlq.translate`
- `nlq.query`

See [docs/MCP_VSCODE.md](./docs/MCP_VSCODE.md) for editor setup.

## Current Product Boundaries

The README should reflect the product honestly, so these constraints are explicit:

- `Migration Studio` currently works from pasted/uploaded input during setup. It is not yet a live remote connector for MySQL, SQL Server, or Mongo deployments.
- workspace scope is real for membership and dashboard metadata, but it does not auto-create isolated physical infrastructure
- the public npm JS/TS SDK package is still pending; the supported path today is direct HTTP plus generated types
- storage ACL composition is intentionally narrower than a full arbitrary-policy builder at edit time

## Quick Start

### Local binary

```bash
git clone https://github.com/Xangel0s/OzyBase.git
cd OzyBase
go run ./cmd/ozybase
```

### Docker

```bash
docker compose up -d --build
```

### Install-to-play bundle

Use `docker-compose.install.yml`.

Required environment values:

- `SITE_URL`
- `APP_DOMAIN`
- `DB_PASSWORD`

Common visible DB values:

- `DB_USER` default `ozybase`
- `DB_NAME` default `ozybase`
- `DB_SSLMODE` default `disable`

### Coolify / managed Postgres

Use `docker-compose.coolify.yml`.

Required:

- `DATABASE_URL`
- `SITE_URL`
- `APP_DOMAIN`

## Production Configuration Notes

At minimum for a serious deployment, set:

```env
PORT=8090
SITE_URL=https://api.example.com
APP_DOMAIN=example.com
ALLOWED_ORIGINS=https://app.example.com,https://api.example.com
JWT_SECRET=<64-byte-random-secret>
DATABASE_URL=postgres://user:pass@db.example.com:5432/ozybase?sslmode=require
DB_POOLER_URL=postgres://user:pass@pool.example.com:6543/ozybase?sslmode=require
RATE_LIMIT_RPS=20
RATE_LIMIT_BURST=20
DEBUG=false
```

Useful optional settings:

- `OZY_STORAGE_PROVIDER=local|s3`
- `OZY_STORAGE_PATH`
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_USE_SSL`
- `OZY_REALTIME_BROKER=local|redis`
- `REDIS_ADDR`, `REDIS_PASSWORD`, `REDIS_DB`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
- `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`
- `OZY_STRICT_SECURITY=true`

Detailed deployment runbook: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

## CLI

The public CLI utilities available in this repo include:

```bash
ozybase init
ozybase version
ozybase upgrade
ozybase functions init hello
```

There are also helper binaries in `cmd/` for benchmarking and password/admin maintenance.

## Validation and QA Gates

The repo includes backend, frontend, smoke, and deployment validation paths. Common release checks:

```bash
go test ./...
```

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate_enterprise.ps1 -SkipE2E
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_frontend_qa.ps1
```

Additional operational validations live in:

- `scripts/validate_external_stack.ps1`
- `scripts/validate_multinode_stack.ps1`
- `scripts/validate_https_smtp_stack.ps1`
- `scripts/smoke_api.sh`
- `scripts/smoke_post_deploy.sh`
- `scripts/deploy_canary.sh`
- `scripts/disaster_drill.sh`

## Documentation

- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)
- [docs/DEPLOYMENT_PROFILES.md](./docs/DEPLOYMENT_PROFILES.md)
- [docs/MCP_VSCODE.md](./docs/MCP_VSCODE.md)
- [docs/PERFORMANCE_BENCHMARKS.md](./docs/PERFORMANCE_BENCHMARKS.md)
- [docs/SECURITY_SUITE.md](./docs/SECURITY_SUITE.md)
- [docs/SECURITY_NOTIFICATIONS.md](./docs/SECURITY_NOTIFICATIONS.md)
- [docs/PROJECT_STATUS_MASTER.md](./docs/PROJECT_STATUS_MASTER.md)
- [docs/ROADMAP.md](./docs/ROADMAP.md)
- [CHANGELOG.md](./CHANGELOG.md)

Developed by **Xangel0s**.
