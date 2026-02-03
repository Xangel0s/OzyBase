# Changelog - OzyBase Core

## [v0.5.0] - Focus on Performance, Modular Architecture & UX - 2026-02-03

### 🚀 Major Features
- **Install-to-Play Experience**: Introduced a `SetupWizard` that runs on first launch.
  - **Clean Slate**: Initializes a minimal admin user.
  - **Secure Fortress**: Automatically enables Geo-Fencing (User Country), Strong Password Policies, and prepares 2FA enforcement.
- **High-Performance Analytics Engine (Go)**:
  - Migrated extensive log processing from Frontend (JS) to Backend (Go).
  - New endpoints `/api/analytics/traffic` and `/api/analytics/geo` leverage PostgreSQL aggregation for millisecond-response stats.
  - Frontend `LogsAnalytics` dashboard rewritten to consume pre-aggregated data, reducing browser load significantly.

### 🛠Backend Refactoring (Clean Architecture)
- **Modular Handlers**: Split the monolithic `integrations.go` into dedicated, single-responsibility modules:
  - `internal/api/secrets.go`: Vault & Secret management.
  - `internal/api/wrappers.go`: Foreign Data Wrappers (Postgres Extensions).
  - `internal/api/webhooks.go`: Cleaned up webhook logic (`WebhookHandler`).
  - `internal/api/cron.go`: Cleaned up cron logic (`CronHandler`).
  - `internal/api/graphql.go`: Dedicated GraphQL resolver handler.
- **Main Router Cleanup**: Updated `cmd/OzyBase/main.go` to inject and use specific handlers instead of a global mono-handler.
- **Legacy Removal**: Deleted obsolete `integrations.go` to prevent technical debt accumulation.

### 🐛 Bug Fixes & Polish
- **Frontend**: Fixed `ReferenceError` for missing icons (`ShieldAlert`, `Search`) in `Layout.jsx` and `SchemaVisualizer.jsx`.
- **API**: Added `/api/tables` alias route to support generic table editors in the frontend.
- **Security**: Hardened initial setup endpoints to prevent unauthorized re-initialization.

### 🧪 Verification
- Backend compiles with strict type checks (Go 1.23+).
- Frontend runs cleanly on Vite.
- System handles "Clean" vs "Secure" initialization modes correctly.
