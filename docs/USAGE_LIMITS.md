# Usage & Limits in Self-Hosted

OzyBase exposes project-scoped usage and limits so a self-hosted installation can operate multiple projects on one shared runtime without confusion.

## 1. What This Replaces

In self-hosted mode, `Billing` is intentionally replaced by `Usage & Limits`.

That means:
- no invoices in the dashboard
- no SaaS plan management in the dashboard
- yes to quotas, warnings, and enforcement

## 2. Usage Metrics Per Project

`GET /api/workspaces/:id/usage` returns project-scoped metrics.

Current metrics:
- `rows`
- `storage_bytes`
- `api_requests`
- `realtime_events`
- `function_invocations`
- `warnings`

Window behavior:
- `rows` and `storage_bytes` are current-state metrics
- request/realtime/function metrics use a rolling 30-day window

## 3. Limits Per Project

`GET /api/workspaces/:id/limits` returns:
- `warning_threshold_pct`
- `rows_hard_limit`
- `storage_bytes_hard_limit`
- `api_requests_soft_limit`
- `realtime_events_soft_limit`
- `function_invocations_soft_limit`

`PATCH /api/workspaces/:id/limits` updates them.

## 4. Enforcement Behavior

### Hard limits

Current hard limits:
- `rows_hard_limit`
- `storage_bytes_hard_limit`

They are enforced in runtime flows:
- row creation
- import/create batches
- upload session creation
- multipart uploads
- upload completion

### Soft limits

Current soft limits:
- `api_requests_soft_limit`
- `realtime_events_soft_limit`
- `function_invocations_soft_limit`

These do not block traffic first. They generate warnings near exhaustion.

## 5. Warning Threshold

`warning_threshold_pct` determines when the backend starts returning warnings for metrics near exhaustion.

Example:
- threshold `80`
- hard limit `10000`
- warning starts when usage reaches `8000`

## 6. Frontend Surfaces

Usage and limits surface in:
- `Settings > Usage & Limits`
- `Overview`
- `Observability`

This is the intended self-hosted operator flow:
1. choose active project
2. inspect current usage
3. set safe limits
4. monitor warnings before the runtime blocks writes

## 7. Relevant Files

- [frontend/src/components/Settings.tsx](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/frontend/src/components/Settings.tsx)
- [frontend/src/components/Overview.tsx](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/frontend/src/components/Overview.tsx)
- [frontend/src/components/Observability.tsx](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/frontend/src/components/Observability.tsx)
- [internal/core/workspace_limits.go](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/internal/core/workspace_limits.go)
- [internal/api/workspace.go](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/internal/api/workspace.go)
- [internal/api/records.go](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/internal/api/records.go)
- [internal/api/files.go](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/internal/api/files.go)
