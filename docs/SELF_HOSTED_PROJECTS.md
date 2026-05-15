# Self-Hosted Projects in OzyBase

OzyBase in self-hosted mode runs as a **single-tenant** instance.
There is exactly one project ("Default"), created automatically on first boot.

## 1. Single-Tenant Contract

| Property | Behavior |
|---|---|
| Number of projects | 1 (auto-created "Default") |
| Project selector in UI | Hidden (static display only) |
| Workspace API | POST/DELETE disabled (HTTP 403) |
| Default workspace | Auto-created via `EnsureDefaultWorkspace()` |
| Bootstrap | `POST /api/workspaces/bootstrap` always returns the default |
| Backups | Daily, 14-day retention, stored in `./backups/` |

## 2. Project Scope

The single project scopes:
- collection metadata
- API keys
- saved views
- usage counters
- storage

## 3. Request Flow

On every authenticated request:
1. `WorkspaceMiddleware` checks for `X-Workspace-Id` header
2. If absent in single-tenant mode, auto-resolves to the default workspace
3. Backend validates membership (admin is auto-assigned as owner)
4. Handlers respond inside the project scope

## 4. What Changed from Multi-Tenant

| Aspect | Before | After |
|---|---|---|
| UI selector | Dropdown with project list | Static project name display |
| Project creation | Via UI or API | Disabled (403) |
| Project deletion | Via Danger Zone | Disabled (403) |
| Access requests | Full workflow | Disabled |
| Workspace bootstrap | Multiple workspaces possible | Always returns Default |

## 5. Relevant Source Files

- `internal/data/db.go` — `EnsureDefaultWorkspace()`
- `internal/config/config.go` — `IsSingleTenant()`
- `internal/api/middleware.go` — `WorkspaceMiddleware`, `SingleTenantGuard`
- `frontend/src/components/WorkspaceSwitcher.tsx` — Static display in single-tenant
- `frontend/src/hooks/useWorkspaceResolution.ts` — Simplified resolution
- `deploy/setup.sh` — One-command deployment
