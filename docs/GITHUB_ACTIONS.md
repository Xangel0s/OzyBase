# GitHub Actions in OzyBase

OzyBase uses GitHub Actions to validate self-hosted product quality before release.

## 1. Main Workflows

| Workflow | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | Main CI for pushes and PRs to `main` |
| `.github/workflows/release.yml` | Release gate, dry run, and tagged publish flow |
| `.github/workflows/canary-deploy.yml` | Canary deployment validation |
| `.github/workflows/disaster-drill.yml` | Backup/restore drill |

## 2. What CI Validates

The main CI workflow checks:
- shell script syntax
- Go tests
- Go build
- Go lint
- frontend lint
- frontend typecheck
- frontend production build
- bundle budget
- API smoke
- Playwright E2E smoke

The E2E smoke includes:
- `tests/smoke-critical.spec.js`
- `tests/selfhosted-usage-limits.spec.js`

That means CI now explicitly verifies the self-hosted `Usage & Limits` flow in addition to the generic smoke path.

## 3. What Release Validates

The release workflow validates:
- backend quality
- frontend build/bundle
- API smoke
- Playwright E2E smoke for self-hosted dashboard behavior
- GoReleaser dry run on PRs
- GoReleaser publish on tags

## 4. Local Command Equivalents

You can mirror the important GitHub Actions checks locally:

Backend:

```bash
go test ./internal/api ./internal/core ./internal/data
```

Frontend:

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm run build
npx playwright test tests/smoke-critical.spec.js tests/selfhosted-usage-limits.spec.js --project=chromium
```

## 5. Why This Matters for Self-Hosted

Because OzyBase is self-host-first, CI should validate:
- real self-hosted UX
- project scoping
- usage and limits
- frontend-operable admin flows

Not just unit tests.
