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
- AI-facing runtime endpoints for NLQ and pgvector workflows

The repo is designed for self-hosting first: local binary, Docker, install-to-play, and Coolify-style managed Postgres deployments are all supported.

## Deployment Priorities

| Target | Status | Recommended for | Notes |
| --- | --- | --- | --- |
| Local PC | Stable | Development, QA, demos | Run API + frontend locally with one PostgreSQL instance. |
| Self-hosted Docker | Stable | Real apps on a single node | Shared DB runtime, full admin panel, quotas, storage, realtime. |
| Coolify | Recommended | The default production path for most users | OzyBase is intentionally optimized for Coolify-style managed Postgres + persistent volumes. |
| Cloud / enterprise control plane | Future track | Dedicated DB, managed billing, PITR UX, replicas | Not part of the self-hosted OSS contract today. |

## Self-Hosted Project Model

In self-hosted mode, OzyBase keeps `workspace` as an internal backend entity but presents it as `Project` in the UI.

| Concept | Self-hosted behavior |
| --- | --- |
| Project | Logical scope only |
| PostgreSQL database | Shared physical DB for the whole installation |
| Schema provisioning | Not automatic |
| Bucket provisioning | Not automatic |
| Team members | Scoped by project |
| API keys | Scoped by project |
| Saved views | Scoped by project |
| Project context | Scoped by project |
| Usage & limits | Scoped by project |

What this means in practice:
- selecting a project stores `ozy_workspace_id` in the frontend
- frontend sends the project context on internal requests
- backend validates membership and role
- reads, metadata, keys, usage, and quotas are applied inside that scope

This gives self-hosted users one installation that can serve multiple projects without pretending that every project is a separate PostgreSQL deployment.

## Documentation Map

| Topic | Doc |
| --- | --- |
| Local development on your PC | [docs/LOCAL_DEVELOPMENT.md](./docs/LOCAL_DEVELOPMENT.md) |
| Coolify deployment | [docs/COOLIFY_DEPLOYMENT.md](./docs/COOLIFY_DEPLOYMENT.md) |
| Self-hosted project/workspace model | [docs/SELF_HOSTED_PROJECTS.md](./docs/SELF_HOSTED_PROJECTS.md) |
| Usage, quotas, and limits | [docs/USAGE_LIMITS.md](./docs/USAGE_LIMITS.md) |
| Feature matrix and frontend-admin surfaces | [docs/FEATURE_MATRIX.md](./docs/FEATURE_MATRIX.md) |
| Architecture gap analysis and hardening priorities | [docs/ARCHITECTURE_CRITICAL_REVIEW.md](./docs/ARCHITECTURE_CRITICAL_REVIEW.md) |
| Final validation plan for project semantics and control plane | [docs/PROJECT_SEMANTICS_CONTROL_PLANE_VALIDATION.md](./docs/PROJECT_SEMANTICS_CONTROL_PLANE_VALIDATION.md) |
| GitHub Actions / CI / release validation | [docs/GITHUB_ACTIONS.md](./docs/GITHUB_ACTIONS.md) |
| Production deployment runbook | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) |
| Deployment profiles | [docs/DEPLOYMENT_PROFILES.md](./docs/DEPLOYMENT_PROFILES.md) |

## Latest Update (2026-04-11)

### Access request notification action flow

The security notification card for pending access requests now performs a complete action path instead of only opening a generic section.

What changed:

- Notification payload now includes a valid action destination (`security`) and an explicit action target (`access_requests`).
- Notification click handling now validates the target view before navigation and falls back safely when needed.
- A cross-component navigation intent event is emitted when the notification target is access validation.
- Security Hub now listens for that intent and auto-scrolls to the `Access Requests` block where admins can approve or reject immediately.

Updated frontend files:

- `frontend/src/components/Layout.tsx`
- `frontend/src/components/SecurityDashboard.tsx`

Validation executed:

```powershell
npm --prefix frontend run build
```

Result: build completed successfully after the navigation/scroll integration.

## Firewall and Geo-Fencing (Phase 1)

OzyBase now supports an outer-wall firewall middleware driven by environment variables.

### Security model

- Default behavior: `OZY_FIREWALL_MODE=off` (disabled)
- Dry run: `OZY_FIREWALL_MODE=log-only` (never blocks, logs what would be blocked)
- Strict mode: `OZY_FIREWALL_MODE=enforce` (hard blocks with HTTP 403)
- Rule precedence:
  1. Internal bypass (`127.0.0.1`, `/api/health`, `/api/project/health`)
  2. IP deny list (`OZY_BLOCKED_IPS` or `OZY_DENIED_IPS`)
  3. IP allow list (`OZY_ALLOWED_IPS`) with Geo check bypass
  4. Country deny/allow (`OZY_BLOCKED_COUNTRIES`, `OZY_ALLOWED_COUNTRIES`)
  5. Default allow

### Anti-spoofing for real client IP

- `X-Forwarded-For` is trusted only when `RemoteAddr` belongs to `OZY_TRUSTED_PROXIES`
- If proxy is not trusted, middleware uses socket remote IP directly

### Geo-Fencing and fail-closed

- Country checks use local MaxMind DB path from `OZY_MAXMIND_DB`
- If Geo rules are configured and DB is missing/corrupt:
  - `enforce`: startup fails (fail-closed)
  - `log-only`: startup continues and logs warning (`[FIREWALL_LOG]`)

### Environment variables

- `OZY_FIREWALL_MODE=off|log-only|enforce`
- `OZY_ALLOWED_IPS=192.168.1.0/24,200.48.10.5`
- `OZY_BLOCKED_IPS=203.0.113.0/24`
- `OZY_DENIED_IPS=203.0.113.0/24` (alias)
- `OZY_TRUSTED_PROXIES=127.0.0.1/32,10.0.0.0/8`
- `OZY_ALLOWED_COUNTRIES=PE`
- `OZY_BLOCKED_COUNTRIES=RU,CN`
- `OZY_MAXMIND_DB=./internal/geoip/GeoLite2-Country.mmdb`
- `OZY_FIREWALL_AUDIT_HEADER=true` (adds `X-Ozy-Firewall` response header)
- `OZY_FIREWALL_DYNAMIC_CACHE_SECONDS=3` (refresh interval for `_v_ip_rules` cache)

### Dynamic firewall rules (no restart)

The middleware now combines strict ENV policy with dynamic DB rules from `_v_ip_rules`.

- Dynamic rule source: `_v_ip_rules` (`ALLOW` / `BLOCK`, supports single IP and CIDR)
- Active rule filter: expired rows are ignored (`expires_at <= NOW()`)
- In-memory cache: refreshed every `OZY_FIREWALL_DYNAMIC_CACHE_SECONDS`
- Near-instant updates: cache is invalidated on `POST /api/security/firewall` and `DELETE /api/security/firewall/:id`

Dynamic precedence inside IP checks:

1. ENV deny
2. Dynamic deny
3. Dynamic allow
4. ENV allow

### Security Hub Threat Meter (Phase 1)

Firewall blocks are now recorded for Security Hub charts.

- Hot path: in-memory atomic counters (very low overhead)
- Persistence: async flush to `_v_security_stats` (when storage is `postgres`)
- Aggregation dimensions: `reason`, `country_code`, `source_ip`
- Time bucket: hourly (`bucket_start`)

New variables:

- `OZY_SECURITY_METRICS_STORAGE=postgres|memory`
- `OZY_SECURITY_METRICS_FLUSH_SECONDS=300`
- `OZY_SECURITY_METRICS_FLUSH_THRESHOLD=500`

Security Hub endpoint:

- `GET /api/security/firewall/metrics?hours=24`

Response includes:

- `total_blocked`
- `by_reason`
- `top_countries`
- `top_ips`
- `pending_buffer`

### Test evidence

Validation executed on 2026-04-10:

```powershell
go test ./internal/api -run Firewall -count=1
ok      github.com/Xangel0s/OzyBase/internal/api        0.210s

go test ./cmd/ozybase -count=1
ok      github.com/Xangel0s/OzyBase/cmd/ozybase 0.133s
```

Covered cases in `internal/api/firewall_test.go`:

- deny precedence over allow
- allow list bypasses Geo check
- country restriction block
- fail-closed behavior for Geo lookup errors in `enforce`
- `log-only` behavior (no block)
- trusted proxy forwarding vs untrusted forwarding

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

## 4. Projects (logical scope in self-hosted)

Projects are powered by the workspace engine and behave as logical scopes in self-hosted mode.

| Capability | Status in self-hosted OSS |
| --- | --- |
| Create/list/update/delete project | Yes |
| Members and roles | Yes |
| Active project routing via `X-Workspace-Id` | Yes |
| Collection metadata scoping | Yes |
| API key scoping | Yes |
| Saved view scoping | Yes |
| Usage & limits by project | Yes |
| Dedicated PostgreSQL database per project | No |
| Dedicated schema per project | No |
| Dedicated physical bucket per project | No |

## Control Ownership Matrix

This is the simplest stable contract for the self-hosted product.

| Area | Runtime plane | Control plane |
| --- | --- | --- |
| Authentication execution | Yes | No |
| Table and record CRUD | Yes | No |
| SQL execution | Yes | No |
| Storage reads/uploads/deletes | Yes | No |
| Realtime event delivery | Yes | No |
| Function invocation | Yes | No |
| Project lifecycle | No | Yes |
| Members and roles | No | Yes |
| Usage accounting | No | Yes |
| Limits and warnings | Runtime consumes rules | Yes |
| Capability exposure | Runtime reads it | Yes |
| Future provisioning contracts | No | Yes |

Near-term direction:
- keep `Project` semantics closed and explicit in self-hosted
- keep governance rules centralized in the control plane
- let runtime modules consume those rules instead of redefining them
- if the product grows into cloud/enterprise later, extract this governance layer into a more explicit module instead of spreading it across features

Core routes:

- `POST /api/workspaces`
- `GET /api/workspaces`
- `PATCH /api/workspaces/:id`
- `DELETE /api/workspaces/:id`
- `GET /api/workspaces/:id/members`
- `POST /api/workspaces/:id/members`
- `DELETE /api/workspaces/:id/members/:userId`
- `GET /api/workspaces/:id/usage`
- `GET /api/workspaces/:id/limits`
- `PATCH /api/workspaces/:id/limits`

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
- `GET /api/project/security/advisor/scan`
- `POST /api/project/security/advisor/fix`
- `GET /api/security/advisor/scan`
- `POST /api/security/advisor/fix`
- `GET /api/project/security/admin-audit`
- `GET /api/security/firewall`
- `POST /api/security/firewall`
- `DELETE /api/security/firewall/:id`
- `POST /api/security/sessions/terminate-by-ip`
- `POST /api/security/sessions/terminate-by-country`
- `POST /api/project/security/sessions/terminate-by-ip`
- `POST /api/project/security/sessions/terminate-by-country`
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

## 10. AI Runtime: NLQ and pgvector

OzyBase exposes an AI-facing admin runtime directly over HTTP for query and vector workflows.

Implemented today:

- pgvector status/setup/upsert/search
- natural language to SQL translate/query
Core routes:

- `GET /api/project/vector/status`
- `POST /api/project/vector/setup`
- `POST /api/project/vector/upsert`
- `POST /api/project/vector/search`
- `POST /api/project/nlq/translate`
- `POST /api/project/nlq/query`
 

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
- [docs/PERFORMANCE_BENCHMARKS.md](./docs/PERFORMANCE_BENCHMARKS.md)
- [docs/SECURITY_SUITE.md](./docs/SECURITY_SUITE.md)
- [docs/SECURITY_NOTIFICATIONS.md](./docs/SECURITY_NOTIFICATIONS.md)
- [docs/PROJECT_STATUS_MASTER.md](./docs/PROJECT_STATUS_MASTER.md)
- [docs/ROADMAP.md](./docs/ROADMAP.md)
- [docs/ARCHITECTURE_CRITICAL_REVIEW.md](./docs/ARCHITECTURE_CRITICAL_REVIEW.md)
- [docs/PROJECT_SEMANTICS_CONTROL_PLANE_VALIDATION.md](./docs/PROJECT_SEMANTICS_CONTROL_PLANE_VALIDATION.md)
- [CHANGELOG.md](./CHANGELOG.md)

Developed by **Xangel0s**.
