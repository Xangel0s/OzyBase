# OzyBase — Agentic Backend-as-a-Service (BaaS)

<p align="center">
  <img src="docs/banner.jpg" alt="OzyBase Banner" width="100%" />
</p>

<p align="center">
  <a href="#-ibm-skillsbuild-challenge-july-2026"><img src="https://img.shields.io/badge/IBM_SkillsBuild-July_2026-blue.svg?style=for-the-badge&logo=ibm" alt="IBM SkillsBuild"></a>
  <a href="#-model-context-protocol-mcp--ai-agent-engine"><img src="https://img.shields.io/badge/AI-MCP_Protocol-purple.svg?style=for-the-badge" alt="MCP Protocol"></a>
  <a href="https://github.com/ibm-granite-community"><img src="https://img.shields.io/badge/IBM_Granite-Embeddings-0F62FE.svg?style=for-the-badge&logo=ibm" alt="IBM Granite"></a>
  <a href="https://golang.org"><img src="https://img.shields.io/badge/Go-1.25-00ADD8.svg?style=for-the-badge&logo=go" alt="Go"></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-19-61DAFB.svg?style=for-the-badge&logo=react" alt="React"></a>
  <a href="https://www.postgresql.org"><img src="https://img.shields.io/badge/PostgreSQL-15-4169E1.svg?style=for-the-badge&logo=postgresql" alt="PostgreSQL"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" alt="License"></a>
</p>

**OzyBase** is an ultra-lightweight, open-source **Agentic Backend-as-a-Service (BaaS)** engineered as a single Go binary with an embedded React 19 administrative dashboard and PostgreSQL 15 database engine.

Operating at **~56 MB total RAM footprint** (~4% of Supabase's memory requirements), OzyBase natively embeds the **Model Context Protocol (MCP)**, allowing autonomous AI agents (such as Claude, Cursor, Windsurf, or IBM Bob) to inspect, migrate, configure, secure, and operate the entire backend infrastructure seamlessly without human intervention.

---

## 📑 Table of Contents

- [Why OzyBase?](#-why-ozybase)
- [Comparison Matrix](#-comparison-matrix)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Performance Benchmarks](#-performance-benchmarks)
- [Model Context Protocol (MCP) & AI Agent Engine](#-model-context-protocol-mcp--ai-agent-engine)
- [IBM SkillsBuild Challenge (July 2026)](#-ibm-skillsbuild-challenge-july-2026)
- [Quick Start](#-quick-start)
- [CLI Reference](#-cli-reference)
- [REST API & Client Pattern](#-rest-api--client-pattern)
- [Self-Hosting & Deployment](#-self-hosting--deployment)
- [Tech Stack](#-tech-stack)
- [License](#-license)

---

## 💡 Why OzyBase?

Modern web and mobile application backends force developers into a painful compromise:

1. **Heavyweight Cloud BaaS (e.g., Supabase)**: Excellent feature set, but consumes **1.2 GB+ of idle RAM** across 12+ Docker microservices. This is prohibitively expensive for indie hackers, small teams, edge devices, and local development.
2. **SQLite-based BaaS (e.g., PocketBase)**: Ultra-lightweight and single-binary, but constrained by SQLite's single-writer concurrency model, lack of native enterprise PostgreSQL features, missing native vector search (`pgvector`), and absence of horizontal scaling.
3. **No Native AI-Agent Control Layer**: Existing platforms are built for humans clicking in web dashboards. Autonomous AI agents (like IBM Bob, Claude Code, or Cursor) lack standardized, safe, and idempotent protocols to manage schemas, configure security policies, and perform migrations autonomously without risking data corruption.

**OzyBase bridges this gap**: It provides the complete power of **PostgreSQL 15 + pgvector**, real-time WebSockets, S3-compatible storage, serverless Edge Functions, and JWT auth in an ultra-compact **~56 MB RAM footprint**, all controlled autonomously through the **Model Context Protocol (MCP)**.

---

## 📊 Comparison Matrix

| Feature | OzyBase | Supabase | PocketBase | Firebase |
|---|:---:|:---:|:---:|:---:|
| **Architecture** | **Single Go Binary** | 12+ Docker Containers | Single Go Binary | Closed Cloud Service |
| **Database Engine** | **PostgreSQL 15** | PostgreSQL 15 | SQLite 3 | NoSQL Firestore |
| **Total Idle RAM** | **~56 MB** | ~1,200 MB+ | ~30 MB | N/A (Cloud) |
| **AI Agent Control (MCP)** | **Native JSON-RPC 2.0** | ❌ (Manual / 3rd Party) | ❌ None | ❌ None |
| **Vector Search** | **Native `pgvector` (HNSW/IVF)** | Native `pgvector` | ❌ None | Extensions / Vertex |
| **Natural Language Queries** | **Built-in NLQ Engine** | ❌ None | ❌ None | ❌ None |
| **Serverless Edge Functions** | **Embedded Goja (JS) + Wazero (WASM)**| Deno Subhosting Containers | JS VM Hooks | Google Cloud Functions |
| **Realtime Engine** | **Native WebSocket CDC** | Realtime Elixir Server | Server-Sent Events (SSE) | Realtime SDK |
| **TypeScript Type Generation** | **Built-in CLI (`gen-types`)** | CLI (`supabase gen types`) | Community tools | Community tools |
| **Self-Healing Key Rotation** | **Atomic 3-Step Pipeline** | Manual Dashboard | Manual | Manual GCP Console |
| **Admin Dashboard** | **Embedded React 19 SPA** | Next.js Container | Svelte SPA | Google Cloud Console |
| **License** | **MIT License** | Apache 2.0 / BSL | MIT License | Proprietary |

---

## ✨ Key Features

### 🗄️ PostgreSQL 15 & Schema-as-Code (Collections)
- **Dynamic Relational Collections**: Define schemas, field types, validation rules, unique constraints, and foreign keys visually or programmatically.
- **PostgREST-Compatible REST API**: Query, filter, paginate, sort, and mutate tables over `/rest/v1/*` or `/api/collections/*`.
- **Automatic Type Generation**: Export strongly typed TypeScript interfaces directly from your live PostgreSQL schema with `ozybase gen-types`.
- **Versioned SQL Migrations**: Create and apply incremental `.sql` migration files stored in `./migrations` with automatic startup verification.

### 🤖 Autonomous AI Control via Model Context Protocol (MCP)
- **Standard JSON-RPC 2.0 Protocol**: Exposed at `/api/project/mcp` for instant integration with Claude, Cursor, Windsurf, VS Code, and IBM Bob.
- **OAuth Device Flow**: Secure agent pairing via `/api/project/mcp/device/start` and browser approval `/approve`.
- **Full Operational Catalog**: 11+ autonomous tools allowing agents to run DDL queries, generate migrations, configure Row Level Security (RLS), rotate credentials, and create backup snapshots.
- **Self-Healing Idempotency**: Automatically handles PostgreSQL constraint conflicts (`SQLSTATE 23505`, `SQLSTATE 23503`) during autonomous agent actions.

### 🧠 Vector Search & AI Embeddings (`pgvector`)
- **Native Vector Indexing**: Accelerated semantic retrieval powered by PostgreSQL `pgvector` extension with HNSW and IVFFlat indexes.
- **Multiple Distance Operators**: Supports Cosine Similarity (`<=>`), L2 Euclidean Distance (`<->`), and Inner Product (`<#>`).
- **Embedding Compatibility**: Optimized for **IBM Granite Embedding models**, OpenAI text-embedding-3, and local HuggingFace models.
- **Natural Language Querying (NLQ)**: Translate plain English questions into optimized, safe SQL queries via `/api/nlq`.

### 🔐 3-Tier Security & Self-Healing Key Engine
- **3-Tier Key Hierarchy**:
  - `anon` key: Public client-side token (browsers, mobile apps) enforced by Row Level Security.
  - `service_role` key: Super Admin bypass token for server-to-server operations and cron jobs.
  - `mcp` token: Dedicated AI agent tokens isolated from infrastructure credentials.
- **Domain Isolation (`managed_kind`)**: Infrastructure keys (`essential`) are isolated from developer tokens (`custom`). Server restarts never revoke user-generated tokens.
- **Atomic Credential Rotation**: Enforces a strict 3-step pipeline: **Deactivate previous -> Insert new -> Link rotation** with zero downtime.

### 🛡️ Automated Security Advisor & Built-in WAF
- **Security Advisor**: Proactively audits all database tables, identifying missing RLS policies, overly permissive public rules, and vulnerable columns.
- **Web Application Firewall (WAF)**: Built-in rate limiting, IP allowlist/blocklist, DDoS defense, and malicious payload sanitization.
- **Immutable Admin Audit Logging**: Records administrative mutations, schema changes, and authentication events in `_ozy_audit_logs`.

### ⚡ Realtime Engine (WebSockets)
- **Change Data Capture (CDC)**: Streams live database changes (`INSERT`, `UPDATE`, `DELETE`) over WebSockets at `/api/realtime`.
- **Granular Table Subscriptions**: Enable or disable realtime broadcasting per table with zero database performance degradation.

### 📁 S3-Compatible Object Storage
- **Public & Private Buckets**: Store media, documents, and creative assets with signed URL support at `/api/files/buckets`.
- **On-the-Fly Image Processing**: Dynamic resizing, format conversion (WebP/AVIF), and optimization.
- **Deduplication & Metadata**: SHA-256 integrity verification and automated MIME detection.

### ⚙️ Serverless Edge Functions (JavaScript & WASM)
- **Embedded Goja Engine**: Executes ES6+ JavaScript handlers directly inside the database layer without external Node.js dependencies.
- **Embedded Wazero Engine**: Zero-dependency WebAssembly runtime for high-performance Rust, Go, or C edge binaries.
- **Sync & Async Execution**: Run synchronous request-response hooks or dispatch long-running jobs to the background queue.

### 📊 Observability & Performance Advisor
- **Prometheus Metrics**: Exposes standardized metrics at `/metrics` (request counts, latency percentiles, database pool saturation).
- **Performance Advisor**: Automatically detects missing indexes on foreign keys, slow sequential scans, and unoptimized vector searches.

### 🖥️ Embedded React 19 Dashboard
- **Single-Binary Delivery**: The entire frontend SPA is compiled and embedded into the Go binary via `embed.FS`.
- **Modern UI Suite**: Built with React 19, Vite, Tailwind CSS v4, Monaco Editor, Recharts, and Lucide icons.
- **Management Suite**: Visual Schema Builder, SQL Query Scratchpad, Realtime Event Monitor, Storage Explorer, Edge Function Editor, and API Key Manager.

### 💾 Automated Database Backups
- **Automated Daily Snapshots**: Generates gzip-compressed PostgreSQL dumps in `./backups/`.
- **Retention & Instant Restore**: Automatic 14-day retention cleanup and single-command point-in-time recovery.

---

## 🏗️ System Architecture

```
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                             Clients & Agents                                │
 │   ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────┐   │
 │   │  Autonomous AI Agent  │  │  Web / Mobile Clients │  │  Admin / CLI  │   │
 │   │ (IBM Bob / Claude)    │  │  (React / Flutter)    │  │  (ozybase)    │   │
 │   └───────────┬───────────┘  └───────────┬───────────┘  └───────┬───────┘   │
 └───────────────┼──────────────────────────┼──────────────────────┼───────────┘
                 │ JSON-RPC 2.0 (MCP)       │ REST / WebSockets    │ CLI Pipes
                 ▼                          ▼                      ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                         OZYBASE ENGINE (~11 MB RAM)                         │
 │                                                                             │
 │   ┌─────────────────────────────────────────────────────────────────────┐   │
 │   │                WAF, CORS & Rate Limiting Middleware                 │   │
 │   └──────────────────────────────────┬──────────────────────────────────┘   │
 │                                      ▼                                      │
 │   ┌─────────────────────────────────────────────────────────────────────┐   │
 │   │          3-Tier Authentication & RBAC (Anon / Service Role)         │   │
 │   └───────┬──────────────────────────┬───────────────────────────┬──────┘   │
 │           ▼                          ▼                           ▼          │
 │   ┌───────────────┐          ┌───────────────┐           ┌──────────────┐   │
 │   │   MCP Server  │          │ PostgREST API │           │ Realtime Hub │   │
 │   │ 11 Core Tools │          │  /rest/v1/*   │           │  WebSockets  │   │
 │   └───────┬───────┘          └───────┬───────┘           └───────┬──────┘   │
 │           ▼                          ▼                           ▼          │
 │   ┌─────────────────────────────────────────────────────────────────────┐   │
 │   │        Self-Healing Essential Keys Engine & Schema Migrator         │   │
 │   └──────────────────────────────────┬──────────────────────────────────┘   │
 │                                      ▼                                      │
 │   ┌─────────────────────────────────────────────────────────────────────┐   │
 │   │             Serverless Edge Functions (Goja JS + Wazero)            │   │
 │   └──────────────────────────────────┬──────────────────────────────────┘   │
 └──────────────────────────────────────┼──────────────────────────────────────┘
                                        │ pgx Connection Pool
                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                         POSTGRESQL 15 (~35 MB RAM)                          │
 │                                                                             │
 │   ┌────────────────────┐  ┌────────────────────┐  ┌─────────────────────┐   │
 │   │ Relational Tables  │  │ Row Level Security │  │ pgvector Embeddings │   │
 │   │   & Collections    │  │    (RLS Rules)     │  │   (HNSW / IVFFlat)  │   │
 │   └────────────────────┘  └────────────────────┘  └─────────────────────┘   │
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ Performance Benchmarks

Measured on Docker under real development and production workloads:

| Service | Memory RAM | Memory Limit | Active PIDs | Idle CPU |
|---|---|---|---|---|
| **OzyBase Core Engine** | **~11 MB** | 256 MB | 14 | < 0.1% |
| **PostgreSQL 15 (Alpine)** | **~35 MB** | 512 MB | 9 | < 0.1% |
| **DB Backup Runner** | **~10 MB** | — | 9 | 0.0% |
| **Total Full Stack** | **~56 MB** | 768 MB | 32 | < 0.2% |

> **Impact**: While Supabase requires ~1.2 GB RAM at idle, OzyBase runs full production workloads at **~56 MB RAM (4% of Supabase's footprint)**, achieving **96% infrastructure cost reduction**.

---

## 🛠️ Model Context Protocol (MCP) & AI Agent Engine

OzyBase natively implements the Model Context Protocol (MCP) JSON-RPC 2.0 at `POST /api/project/mcp`. AI agents (Cursor, VS Code, Claude Desktop, IBM Bob, custom LLMs) can inspect, modify, and operate the entire infrastructure autonomously.

### Available MCP Tools Catalog

| MCP Tool | Description | Arguments |
|---|---|---|
| ⚡ `sql.query` | Executes arbitrary SQL/DDL/DML queries with Super Admin privileges. | `query` (string) |
| 📜 `migration.create` | Generates and applies a versioned `.sql` file in `./migrations`. | `name` (string), `sql` (string) |
| 🔒 `rls.configure` | Configures Row Level Security (RLS) enforcement and table rules. | `table` (string), `enabled` (bool), `rule` (optional string) |
| 🔑 `keys.rotate` | Rotates essential API credentials (`anon` or `service_role`) safely. | `role` (`'anon'` or `'service_role'`) |
| 💾 `backup.create` | Creates a timestamped database backup snapshot of schemas & data. | `label` (optional string) |
| 📋 `schema.list_tables` | Lists user database tables with RLS and Realtime state. | *None* |
| 📡 `realtime.toggle` | Enables or disables Realtime WebSocket events for a table. | `table` (string), `enabled` (bool) |
| 📁 `storage.create_bucket` | Creates public or private S3-compatible storage buckets. | `name` (string), `public` (bool) |
| ⚙️ `functions.deploy` | Deploys or updates Edge Functions in JavaScript or WebAssembly. | `name` (string), `script` (string), `runtime` (string) |
| 📖 `system.guide` | Returns comprehensive operational guide and schema docs for LLMs. | *None* |
| 🏥 `system.health` | Returns infrastructure health metrics, pool state, and uptime. | *None* |

### Connecting an AI Agent via MCP

1. **Generate Configuration**:
   ```bash
   ozybase mcp config --out .cursor/mcp.json
   ```
2. **Authorize Device Flow**:
   Initiate device pairing from the agent client:
   ```bash
   curl -X POST http://localhost:8090/api/project/mcp/device/start
   ```
   Open the returned verification URL in your browser:
   ```
   http://localhost:8090/api/project/mcp/device/approve?user_code=XXXX-XXXX
   ```
   Click **Approve Connection** to grant the agent secure credentials.

---

## 🏆 IBM SkillsBuild Challenge (July 2026)

### 📌 Selected Challenge Theme
> **Reinventing Creative Industries with AI** — Empowering creators, developers, and studios to build AI-native content platforms faster, smarter, and at a fraction of the infrastructure cost.

### 1. Problem Statement
The creative industry is undergoing an AI revolution — but backend infrastructure has lagged behind:
- **Prohibitive Infrastructure Costs**: Hosting an AI-enabled creative platform on traditional BaaS platforms requires heavy virtual machines ($20–$50+/month) just to stay idle.
- **DevOps Friction Kills Creative Momentum**: Managing schema migrations, vector indexes, RLS policies, and key rotations pulls creative developers away from building experiences.
- **Lack of an Agentic Control Layer**: No safe, standardized protocol existed for AI agents (like IBM Bob) to autonomously manage backend infrastructure without human intervention.

### 2. Solution Overview
OzyBase serves as the **autonomous AI-native backend engine** for creative platforms:
- **~56 MB RAM Footprint**: Enables creators to run their backend on low-cost edge servers or local devices.
- **Native Semantic Search (`pgvector`)**: Stores and queries multimodal embeddings (scripts, prompts, image metadata, audio transcripts) with sub-millisecond retrieval.
- **IBM Granite Embedding Integration**: Compatible with IBM Granite Embedding models for semantic search without third-party vendor lock-in.
- **Serverless Edge Functions**: Embedded Goja and Wazero runtimes execute AI generation and recommendation logic directly at the database layer.

### 3. How IBM Bob Was Used
**IBM Bob** served as the core AI pair programmer throughout the development and hardening lifecycle of OzyBase:
1. **Agentic Security Architecture**: Co-designed the self-healing key sync engine in `internal/api/essential_keys.go`, including the idempotent 3-step credential rotation pipeline.
2. **PostgreSQL Transaction Hardening**: Diagnosed and resolved critical PostgreSQL constraint conflicts (`idx_api_keys_active_essential_role` unique index, `rotated_to_key_id_fkey` foreign key race conditions) through iterative spec-driven development.
3. **Self-Documentation & MCP Tooling**: Architected the dynamic `system.guide` tool and JSON-RPC 2.0 handler (`internal/api/mcp.go`), allowing LLMs to understand the architecture without manual documentation.
4. **Resilience & Security Hardening**: Refactored REST/RLS middleware to guarantee OWASP compliance and tested key rotation flows under concurrent load.

---

## 🚀 Quick Start

### Prerequisites
- **Docker & Docker Compose** (recommended) OR **Go 1.25+**
- Git

### One-Command Deployment (Docker Compose)
```bash
# 1. Clone the repository
git clone https://github.com/Xangel0s/OzyBase.git
cd OzyBase

# 2. Start services (OzyBase + PostgreSQL + Backups)
docker compose up -d

# 3. Open the administrative dashboard
open http://localhost:8090
```

### Local Development Setup
```bash
# Terminal 1: Backend Go Engine (Port 8090)
go run ./cmd/ozybase

# Terminal 2: Frontend React Dashboard (Port 5342)
cd frontend
npm install
npm run dev
```

---

## 💻 CLI Reference

OzyBase includes a comprehensive command-line interface:

| Command | Description |
|---|---|
| `ozybase gen-types [--out path]` | Generates TypeScript interfaces from the live PostgreSQL schema. |
| `ozybase migrate create <name>` | Generates a new timestamped migration file in `./migrations`. |
| `ozybase migrate apply` | Applies all pending SQL migrations to the database. |
| `ozybase mcp config [--out path]` | Generates Cursor/VS Code MCP server configuration files. |
| `ozybase mcp connect` | Prints step-by-step instructions for connecting AI agents. |
| `ozybase functions init <name>` | Scaffolds a new JavaScript Edge Function template. |
| `ozybase admin create` | Creates a new Super Admin account interactively or via flags. |
| `ozybase admin reset-password` | Resets the password for an existing administrator. |
| `ozybase clean` / `db-reset` | Wipes development data and resets the database schema. |
| `ozybase upgrade` | Checks and installs the latest binary release from GitHub. |
| `ozybase version` | Prints the current binary version and build metadata. |

---

## 🌐 REST API & Client Pattern

OzyBase exposes a standard PostgREST-compatible REST API under `/rest/v1`:

### Query Records (with Filtering & Ordering)
```bash
curl -X GET "http://localhost:8090/rest/v1/posts?select=id,title,created_at&status=eq.published&order=created_at.desc&limit=10" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>"
```

### Insert a Record
```bash
curl -X POST "http://localhost:8090/rest/v1/posts" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Building with OzyBase",
    "content": "Agentic BaaS powered by Go and PostgreSQL.",
    "status": "published"
  }'
```

### TypeScript Client Usage
```typescript
import { useState, useEffect } from 'react';

interface Post {
  id: string;
  title: string;
  content: string;
  status: string;
}

const API_URL = 'http://localhost:8090';
const ANON_KEY = process.env.VITE_OZYBASE_ANON_KEY;

export async function fetchPublishedPosts(): Promise<Post[]> {
  const response = await fetch(`${API_URL}/rest/v1/posts?status=eq.published&order=created_at.desc`, {
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch posts: ${response.statusText}`);
  }

  return response.json();
}
```

---

## 🔒 Self-Hosting & Deployment

### Reverse Proxy Configuration (Caddy)
Caddy automatically provisions SSL certificates via Let's Encrypt:

```caddy
base.yourdomain.com {
    reverse_proxy localhost:8090
}
```

### Production Checklist
1. Generate secure secrets in `.env`:
   - `JWT_SECRET`: Random 64-character string
   - `OZY_ANON_KEY`: Client access token
   - `OZY_SERVICE_ROLE_KEY`: Admin access token
   - `DATABASE_URL`: Production PostgreSQL connection string
2. Configure SMTP credentials (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`) for user invites and security alerts.
3. Keep `./backups/` and `postgres_data` included in offsite backup policies.

---

## 🏗️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Backend Core** | Go 1.25, Echo Framework, pgx pool | High-concurrency, low-latency compiled binary. |
| **Agentic Protocol** | Model Context Protocol (MCP JSON-RPC 2.0) | Standardized interface for AI agent control. |
| **AI Partner** | IBM Bob | Pair programmer and architectural co-designer. |
| **AI Embeddings** | [IBM Granite Embeddings](https://github.com/ibm-granite-community) | High-accuracy semantic search via `pgvector`. |
| **Dashboard UI** | React 19, Vite, Tailwind CSS v4, Monaco Editor | Embedded administrative single-page application. |
| **Database Engine** | PostgreSQL 15 + `pgvector` extension | Relational storage, RLS, and vector similarity search. |
| **JavaScript Edge** | Goja (embedded ECMAScript 5.1/6 engine) | Zero-dependency serverless script execution. |
| **WASM Edge** | Wazero (zero-dependency WASI engine) | Native WebAssembly execution directly in Go. |

---

## 📄 License

Licensed under the **MIT License** — free and open for self-hosting, modification, and commercial deployment without restrictions.
