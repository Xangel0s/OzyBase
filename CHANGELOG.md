# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0-Enterprise] - 2026-02-05

### Added
- **Ozy-Migrations**: Automatic migration generation from Dashboard UI changes.
- **Ozy-Apply**: CLI tool (`migrate-apply`) to apply pending SQL migrations from the local `./migrations` directory.
- **Native Row Level Security (RLS)**: Context injection into Postgres transactions via JWT claims (`request.jwt.claim.sub`).
- **Hybrid Storage**: Support for S3-Compatible backends (Minio, AWS, etc.) and Local storage.
- **Distributed Realtime**: Redis Pub/Sub integration for multi-node event broadcasting.
- **Prometheus Observability**: `/metrics` endpoint with counters for HTTP and DB operations.
- **OAuth Social Login**: Built-in support for GitHub and Google authentication.
- **Advanced Migrations**: Included mission-critical tables for OAuth identities, reset tokens, and verification tokens.

### Changed
- Refactored `internal/data/records.go` to use `WithTransactionAndRLS` for all CRUD operations, enabling native Postgres security policies.
- Enhanced API Handler with dependency injection for Storage, PubSub, and Migrator providers.

## [1.0.0] - 2026-02-04

### Added
- **Embedded PostgreSQL**: Zero-config "Install to Play" engine.
- **JS/TS SDK**: Official library for Supabase-style interaction.
- **Type Generator**: CLI command `gen-types` to export TypeScript interfaces.
- **Embedded Frontend**: React/Vite dashboard baked into the Go binary.
- **Internal Analytics**: Real-time traffic and geolocation monitoring.

---
**OzyBase: Power in a single binary.** 🛡️🚀
