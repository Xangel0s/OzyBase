# OzyBase

<p align="center">
  <img src="https://raw.githubusercontent.com/Xangel0s/OzyBase/main/docs/banner.jpg" alt="OzyBase" width="100%" />
</p>

**Open-source Backend-as-a-Service. Single Go binary, embedded React dashboard, PostgreSQL engine. Self-host first.**

---

## Why OzyBase exists

| | Supabase | Firebase | OzyBase |
|---|---|---|---|
| **Runtime** | Node.js + Go | Node.js | **Pure Go** |
| **Memory** | ~1.2 GB | ~512 MB | **~56 MB** |
| **Dashboard** | Separate containers | Separate services | **Embedded** |
| **Deploy** | Docker Compose (heavy) | Cloud only | **Single binary or Docker** |
| **Edge Functions** | Deno (heavy) | Cloud Functions | **Goja JS engine** |
| **AI / NLQ** | Limited | Vertex only | **Built-in pgvector + NLQ** |

OzyBase is not a Supabase clone. It is a **zero-bloat alternative** for developers who want the same power with **4% of the RAM footprint**.

---

## What you get

- **PostgreSQL collections API** — Dynamic tables without migrations.
- **Auth & API keys** — JWT auth, anonymous + service role keys, 2FA.
- **Storage** — S3-compatible buckets with RLS policies.
- **Edge Functions** — JavaScript runtime inside the Go binary (no Deno, no Node).
- **Realtime** — WebSocket channels, presence, broadcast.
- **AI Runtime** — Natural language to SQL, vector search via pgvector.
- **Security** — RLS policies, audit logs, firewall, geo-blocking.
- **Observability** — Health checks, metrics, notification center.

All of the above ships as **one container** (~11 MB RAM) + **one Postgres container** (~35 MB RAM).

---

## Benchmarks

Real Docker measurements, development workload:

| Service | RAM Used | Limit | PIDs |
|---------|----------|-------|------|
| OzyBase Core | **~11 MB** | 256 MB | 14 |
| PostgreSQL 15 | **~35 MB** | 512 MB | 9 |
| DB Backup | **~10 MB** | — | 9 |
| **Total Stack** | **~56 MB** | 768 MB | 32 |

```bash
# Verify yourself
docker stats --no-stream ozybase ozybase-db ozybase-db-backup
```

---

## Quick Start

```bash
# Clone
git clone https://github.com/Xangel0s/OzyBase.git
cd OzyBase

# One-command deploy
bash deploy/setup.sh

# Or manually
docker compose up -d

# Open dashboard
open http://localhost:8090
```

Default credentials are generated in `.env` after `setup.sh`.

---

## Stack

| Layer | Tech |
|-------|------|
| Backend | Go 1.25, Echo, pgx |
| Frontend | React 19, Vite, Tailwind CSS, shadcn/ui |
| Database | PostgreSQL 15 (Alpine) |
| JS Runtime | Goja (embedded V8-like) |
| WASM | Wazero (WASI) |

---

## Project Structure

```
OzyBase/
├── cmd/ozybase/          # Go entrypoint
├── internal/             # Core backend (api, data, core)
├── frontend/             # React dashboard (Vite)
│   └── src/components/   # UI modules
├── functions/            # Edge function templates
├── migrations/           # Schema migrations (Go-managed)
├── docs/                 # Deployment guides
├── docker-compose.yml    # Full stack definition
└── Dockerfile            # Multi-stage build
```

---

## Useful Commands

```bash
# Health
curl http://localhost:8090/api/health

# Logs
docker compose logs -f ozybase

# Backup now
docker compose exec db-backup /backup.sh

# Restore
gunzip < backups/backup-*.sql.gz | docker compose exec -T db psql -U postgres -d ozybase

# Edge function invoke
curl http://localhost:8090/api/functions/my_fn/invoke

# Rebuild after code changes
docker compose up -d --build
```

---

## Deployment Paths

| Target | Command | Best For |
|--------|---------|----------|
| Local dev | `docker compose up -d` | Development, demos |
| Self-hosted | `bash deploy/setup.sh` | Single-node production |
| Coolify | `docker-compose.coolify.yml` | Managed VPS |

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full runbooks.

---

## License

MIT — self-host without limits.
