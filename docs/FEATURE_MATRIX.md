# OzyBase Feature Matrix

This is the practical feature map for self-hosted OzyBase today.

## 1. Product Modules

| Module | Managed from frontend | Backend enforcement/runtime | Self-hosted status |
| --- | --- | --- | --- |
| Setup Wizard | Yes | Yes | Stable |
| Projects | Yes | Yes | Stable |
| Authentication | Yes | Yes | Stable |
| Table Editor | Yes | Yes | Stable |
| SQL Editor | Yes | Yes | Stable |
| Storage | Yes | Yes | Stable |
| Realtime inspector | Yes | Yes | Stable |
| Edge Functions | Yes | Yes | Stable |
| Observability | Yes | Yes | Stable |
| API keys | Yes | Yes | Stable |
| MCP | Yes | Yes | Stable |
| Usage & Limits | Yes | Yes | Stable |

## 2. What Frontend Can Operate

The frontend already handles normal admin operations for:
- setup
- login and admin auth flows
- table browsing and record CRUD
- SQL execution
- storage buckets and uploads
- project switching
- members and API keys
- MCP quick access
- usage and project limits
- observability and advisors

## 3. What Still Belongs to Cloud / Enterprise

| Capability | Self-hosted OSS | Cloud / enterprise track |
| --- | --- | --- |
| Dedicated DB per project | No | Future |
| Dedicated schema per project | No | Future |
| Managed billing | No | Future |
| PITR UX | No | Future |
| Replicas UI | No | Future |
| Failover UX | No | Future |

## 4. What Project Scopes Today

| Scoped by project | Status |
| --- | --- |
| Members | Yes |
| API keys | Yes |
| Collection metadata | Yes |
| Saved views | Yes |
| MCP context | Yes |
| Usage & limits | Yes |
| Physical DB | No |
| Physical schema | No |
| Physical bucket | No |
