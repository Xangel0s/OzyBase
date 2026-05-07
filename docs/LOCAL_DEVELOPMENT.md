# Local Development on Your PC

This is the recommended local development flow for OzyBase on your own machine.

## 1. Recommended Paths

| Mode | Use when | Result |
| --- | --- | --- |
| Docker Compose | You want the full stack quickly | API + Postgres in containers |
| Local frontend + local API | You are actively editing UI and backend | Fast iteration with hot reload |

## 2. Minimum Requirements

- Go 1.25+
- Node 22+
- npm
- Docker Desktop or Docker Engine
- PostgreSQL available either via compose or external runtime

## 3. Environment

Create `.env` next to `docker-compose.yml`:

```env
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=ozybase
DB_SSLMODE=disable
JWT_SECRET=replace-with-a-long-random-secret
SITE_URL=http://127.0.0.1:8090
APP_DOMAIN=localhost
ALLOWED_ORIGINS=http://127.0.0.1:5342,http://localhost:5342
DEBUG=true
OZY_DEPLOYMENT_PROFILE=single_project_local
```

## 4. Quick Local Docker Run

```bash
docker compose up -d --build
```

Then open:
- API: `http://127.0.0.1:8090`
- Health: `http://127.0.0.1:8090/api/health`

## 5. Frontend + Backend Dev Mode

Run backend from repo root:

```bash
go run ./cmd/ozybase
```

Run frontend from `frontend/`:

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 5342
```

Then open:
- UI: `http://127.0.0.1:5342`
- API: `http://127.0.0.1:8090`

## 6. First Login

If the system is not initialized, use the setup wizard.

Recommended first project name:
- `Primary Project`

Important:
- in self-hosted mode this creates a logical project
- it does not create another PostgreSQL database

## 7. Local Validation Commands

Backend:

```bash
go test ./internal/api ./internal/core ./internal/data
```

Frontend:

```bash
cd frontend
npm run typecheck
npm run build
npx playwright test tests/smoke-critical.spec.js --project=chromium
```

Self-hosted project/limits smoke:

```bash
cd frontend
npx playwright test tests/selfhosted-usage-limits.spec.js --project=chromium
```

## 8. What Local Development Mirrors

Local development is a valid self-hosted runtime shape:
- shared DB
- project scoping
- admin dashboard
- storage
- SQL editor
- usage/limits

Cloud-only control-plane behaviors are not part of the local contract.
