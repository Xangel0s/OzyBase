# OzyBase — Agentic Backend-as-a-Service (BaaS)

<p align="center">
  <img src="docs/banner.jpg" alt="OzyBase Banner" width="100%" />
</p>

<p align="center">
  <a href="#-ibm-skillsbuild-challenge-july-2026"><img src="https://img.shields.io/badge/IBM_SkillsBuild-July_2026-blue.svg?style=for-the-badge&logo=ibm" alt="IBM SkillsBuild"></a>
  <a href="#-ai-approach--architecture"><img src="https://img.shields.io/badge/AI-MCP_Protocol-purple.svg?style=for-the-badge" alt="MCP Protocol"></a>
  <a href="https://golang.org"><img src="https://img.shields.io/badge/Go-1.25-00ADD8.svg?style=for-the-badge&logo=go" alt="Go"></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-19-61DAFB.svg?style=for-the-badge&logo=react" alt="React"></a>
  <a href="https://www.postgresql.org"><img src="https://img.shields.io/badge/PostgreSQL-15-4169E1.svg?style=for-the-badge&logo=postgresql" alt="PostgreSQL"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" alt="License"></a>
</p>

**OzyBase** is the open-source, ultra-lightweight **Agentic Backend-as-a-Service (BaaS)** engineered to run as a single Go binary with an embedded React dashboard and PostgreSQL database engine.

Operating at **~56 MB total RAM footprint** (~4% of Supabase's memory requirements), OzyBase natively embeds the **Model Context Protocol (MCP)**, allowing autonomous AI agents (such as Claude, Cursor, Windsurf, or IBM Bob) to inspect, configure, and operate the entire backend infrastructure seamlessly without human intervention.

---

## 🏆 IBM SkillsBuild Challenge (July 2026)

### 📌 Selected Challenge Theme
> **Artificial Intelligence Innovation & Autonomous Agents for Resilient Cloud Infrastructure**

---

### 1. Problem Statement
Modern Backend-as-a-Service (BaaS) platforms like Supabase or Firebase present three critical bottlenecks for production deployments and AI agent integration:

1. **Heavy Resource Footprint**: Traditional multi-container setups require over 1.2 GB of RAM even in idle states, making them expensive to deploy on VPS edge infrastructure or embedded devices.
2. **DevOps & Human Intervention Bottleneck**: Schema migrations, Row Level Security (RLS) policies, API key rotations, and database backups require continuous manual developer commands.
3. **Lack of Native Agentic Protocols**: Large Language Models (LLMs) lack a standardized, safe, and structured protocol to manage backend infrastructure as autonomous administrators without risking database corruption, deadlocks, or constraint violations.

---

### 2. Solution Overview
**OzyBase** solves this by pairing a high-performance Go engine with a **native Agentic Control Layer via MCP**:

* **Unified ~56 MB RAM Engine**: Delivers REST APIs, Realtime WebSockets, JavaScript Edge Functions, S3-compatible Storage, and JWT Auth in a single binary.
* **Autonomous AI Operations via MCP (Model Context Protocol)**: Exposes an HTTP/JSON-RPC 2.0 endpoint at `/api/project/mcp` providing a self-discoverable tool catalog for AI agents to:
  - 🛠️ Safely execute SQL & DDL queries (`sql.query`).
  - 📜 Generate & apply versioned SQL migrations (`migration.create`).
  - 🔒 Configure Row Level Security (RLS) policies on the fly (`rls.configure`).
  - 🔑 Rotate essential API keys with self-healing idempotency (`keys.rotate`).
  - 💾 Create timestamped database backup snapshots (`backup.create`).
  - 📖 Inspect system architecture and operational guidelines in real time (`system.guide`).

---

### 3. AI Approach & Architecture

```
 ┌─────────────────────────────────────────────────────────────┐
 │                     Autonomous AI Agent                     │
 │          (IBM Bob / Claude / Cursor / LLM Client)           │
 └──────────────────────────────┬──────────────────────────────┘
                                │ JSON-RPC 2.0 (MCP Protocol)
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                      OZYBASE ENGINE                         │
 │                                                             │
 │   ┌───────────────────────┐     ┌───────────────────────┐   │
 │   │   MCP Handler & Tools │     │ REST & Auth Middleware│   │
 │   │   (internal/api/mcp)  │     │ (internal/api/middleware) │
 │   └───────────┬───────────┘     └───────────┬───────────┘   │
 │               │                             │               │
 │               ▼                             ▼               │
 │   ┌─────────────────────────────────────────────────────┐   │
 │   │       Self-Healing Essential Keys Engine           │   │
 │   │         (internal/api/essential_keys.go)            │   │
 │   └─────────────────────────┬───────────────────────────┘   │
 └─────────────────────────────┼───────────────────────────────┘
                               │ pgx Pool / Transactions
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                      POSTGRESQL 15                          │
 │    Tables, RLS Policies, Vector Search (pgvector), Triggers   │
 └─────────────────────────────────────────────────────────────┘
```

#### Core AI Architectural Pillars:
1. **Model Context Protocol (MCP)**: Open standard JSON-RPC 2.0 interface at `/api/project/mcp` enabling dynamic tool discovery and real-time self-documentation (`system.guide`).
2. **Self-Healing Idempotent Engine**:
   - Automatically handles PostgreSQL uniqueness constraints (`SQLSTATE 23505`) and foreign key constraints (`SQLSTATE 23503`) during autonomous agent actions.
   - Enforces an atomic 3-step credential rotation pipeline: **Deactivate previous -> Insert new -> Link rotation**.
3. **Domain Isolation (`managed_kind`)**:
   - Strictly isolates infrastructure keys (`essential`: `anon` / `service_role`) from custom developer keys (`custom`). Server restarts and key rotations never revoke developer API keys or MCP client tokens.
4. **Vector Search Engine**: Native embedding support and semantic search powered by `pgvector`.

---

### 4. How IBM Bob Was Used

**IBM Bob** served as the advanced AI pair programming copilot throughout the development and hardening lifecycle of OzyBase:

1. **Agentic Security Architecture**: Co-designed the self-healing key sync engine in `internal/api/essential_keys.go`.
2. **PostgreSQL Transaction Hardening**: Diagnosed and defensively resolved PostgreSQL constraint edge cases (`idx_api_keys_active_essential_role` and `rotated_to_key_id_fkey`).
3. **Self-Documentation & Tooling Integration**: Created the dynamic system guide generator (`system.guide`) enabling LLMs to understand table structures and security models without human assistance.
4. **Resilience Testing & Refactoring**: Refactored REST/RLS middleware to guarantee OWASP and RFC compliance.

---

### 5. Challenge Context: IBM SkillsBuild (July)

Developed and submitted for the **July 2026 Edition** of the **IBM SkillsBuild** program, demonstrating practical cloud architecture in Go, enterprise security, LLM integration via MCP, and DevSecOps best practices.

---

## ⚡ Performance Benchmarks

Real measurements on Docker (Development workload):

| Service | Memory RAM | Limit | PIDs |
|---|---|---|---|
| **OzyBase Core** | **~11 MB** | 256 MB | 14 |
| **PostgreSQL 15 (Alpine)** | **~35 MB** | 512 MB | 9 |
| **DB Backup Service** | **~10 MB** | — | 9 |
| **Total Full Stack** | **~56 MB** | 768 MB | 32 |

> **Comparison**: While a comparable Supabase stack requires ~1.2 GB RAM, OzyBase runs full production workloads at **~56 MB RAM (4% footprint)**.

---

## 🛠️ MCP Tools for AI Agents

| MCP Tool | Description | Parameters |
|---|---|---|
| 💾 `backup.create` | Creates a timestamped database backup snapshot of schemas & data. | `label` *(optional)* |
| 🔑 `keys.rotate` | Rotates essential API keys (`anon` or `service_role`) safely. | `role` (`anon` or `service_role`) |
| 📜 `migration.create` | Creates and applies versioned SQL migration files in `./migrations`. | `name`, `sql` |
| 🔒 `rls.configure` | Configures Row Level Security (RLS) enforcement and rules. | `table`, `enabled`, `rule` |
| ⚡ `sql.query` | Executes arbitrary SQL/DDL/DML queries. | `query` |
| 📋 `schema.list_tables` | Lists user database tables with RLS and Realtime state. | N/A |
| 📡 `realtime.toggle` | Enables or disables Realtime WebSocket events per table. | `table`, `enabled` |
| 📁 `storage.create_bucket` | Creates public or private S3-compatible storage buckets. | `name`, `public` |
| ⚙️ `functions.deploy` | Deploys or updates Edge Functions in JavaScript/WASM. | `name`, `script`, `runtime` |
| 📖 `system.guide` | Returns comprehensive operational guide & architecture for AI agents. | N/A |
| 🏥 `system.health` | Returns infrastructure health metrics and service state. | N/A |

---

## 🚀 Quick Start

### Prerequisites
* Git
* Docker & Docker Compose (or Go 1.25+)

### One-Command Deployment
```bash
# 1. Clone repository
git clone https://github.com/Xangel0s/OzyBase.git
cd OzyBase

# 2. Deploy with Docker Compose
docker compose up -d

# 3. Open dashboard in browser
open http://localhost:8090
```

### Local Development Setup
```bash
# Backend Go Engine (Port 8090)
go run ./cmd/ozybase

# Frontend React Dashboard (Port 5342)
cd frontend
npm install
npm run dev
```

---

## 🏗️ Tech Stack

| Layer | Tech |
|---|---|
| **Backend Core** | Go 1.25, Echo Framework, pgx pool |
| **Agentic Protocol** | MCP (Model Context Protocol JSON-RPC 2.0) |
| **Dashboard UI** | React 19, Vite, Tailwind CSS, shadcn/ui |
| **Database Engine** | PostgreSQL 15 + pgvector extension |
| **JS Engine (Edge)** | Goja (embedded V8-like engine) |
| **WASM Engine** | Wazero (zero-dependency WASI engine) |

---

## 📄 License

Licensed under the **MIT License** — free and open for self-hosting, modification, and commercial deployment without limits.
