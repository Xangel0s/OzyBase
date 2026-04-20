# Coolify Deployment Guide

OzyBase is intentionally optimized for Coolify-style self-hosted deployments.

If you want the recommended production path for most users, use Coolify with:
- managed PostgreSQL
- persistent volumes
- one OzyBase app service
- optional S3-compatible object storage
- optional Redis for distributed realtime

## 1. Why Coolify Is a First-Class Target

Coolify fits OzyBase well because it gives:
- simple Docker Compose deployment
- managed domain and TLS
- easy env var management
- persistent volumes
- managed PostgreSQL connectivity

That matches OzyBase's self-hosted architecture:
- one runtime
- one shared DB
- multiple logical projects

## 2. Recommended Stack

| Component | Recommended in Coolify |
| --- | --- |
| OzyBase app | One app service on port `8090` |
| PostgreSQL | Managed service or private external Postgres |
| Storage | Local for single-node, S3-compatible for durable multi-node |
| Realtime broker | Local for one node, Redis for multi-node |
| Domain | Coolify-managed custom domain |
| TLS | Coolify-managed HTTPS |

## 3. Minimum Variables

Required:
- `DATABASE_URL`
- `JWT_SECRET`
- `SITE_URL`
- `APP_DOMAIN`
- `ALLOWED_ORIGINS`

Recommended:
- `DB_POOLER_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `OZY_STRICT_SECURITY=true`
- `OZY_STORAGE_PROVIDER=s3` for durable object storage
- `OZY_REALTIME_BROKER=redis` when scaling beyond one app node

## 4. Coolify Runtime Model

In Coolify, OzyBase still behaves as self-hosted:
- project = logical scope
- DB = shared physical runtime

That means your first production install can serve multiple projects without provisioning multiple PostgreSQL databases.

## 5. Deploy Steps

1. Create PostgreSQL in Coolify or bring an external managed Postgres.
2. Point `DATABASE_URL` to that database.
3. Add a persistent volume for OzyBase data where needed.
4. Deploy OzyBase using:
   - `docker-compose.coolify.yml`, or
   - your adapted self-host compose
5. Attach domain and HTTPS.
6. Open `/api/health` and confirm `200`.
7. Finish setup wizard and create `Primary Project`.

## 6. Recommended Self-Hosted Defaults in Coolify

For most users:
- `OZY_DEPLOYMENT_PROFILE=self_host`
- shared DB
- logical projects
- project-scoped usage and limits

Do not market that install as:
- dedicated DB per project
- managed billing
- managed PITR
- replicas/failover product

Those are separate cloud or enterprise tracks.

## 7. Scaling Guidance

### Single node
Use:
- local broker
- local or S3 storage
- shared PostgreSQL

### Multi-node
Use:
- Redis broker for realtime fan-out
- S3-compatible storage
- external PostgreSQL
- pooler if needed

## 8. Validation After Deploy

Minimum checks:

```bash
curl -i https://your-domain/api/health
```

Then validate:
- setup wizard works
- first project is created
- `Settings > Usage & Limits` loads
- `Connected` modal loads keys and MCP JSON
- storage uploads work
- SQL editor opens
- realtime status loads

See also:
- [docs/DEPLOYMENT.md](./DEPLOYMENT.md)
- [docs/DEPLOYMENT_PROFILES.md](./DEPLOYMENT_PROFILES.md)
