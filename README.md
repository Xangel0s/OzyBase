# OzyBase Core 🛡️🚀

![OzyBase Banner](./docs/banner.jpg)

> 🚧 **Development Status**: See [PROJECT_STATUS_MASTER.md](./PROJECT_STATUS_MASTER.md) for live roadmap and consolidated audit report.

[![Go Report Card](https://goreportcard.com/badge/github.com/Xangel0s/OzyBase)](https://goreportcard.com/report/github.com/Xangel0s/OzyBase)
[![Tests Passing](https://img.shields.io/badge/tests-passing-brightgreen.svg)](https://github.com/Xangel0s/OzyBase)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Single Binary](https://img.shields.io/badge/Single-Binary-blueviolet.svg)](#)

**The high-performance, open-source Backend-as-a-Service (BaaS) for the next generation of apps.** 

OzyBase allows you to create dynamic collections, manage authentication, handle real-time subscriptions, and store files with **zero configuration** and **minimal resource usage**.

> **💡 Real World Fact:** OzyBase runs perfectly on a $5/mo VPS while others require $20-40/mo just to idle. **1/8 of the cost, same power.**

---

## ⚡ Why OzyBase?

| Metric | Supabase (Docker) | PocketBase | **OzyBase-Core** |
|--------|-------------------|------------|-------------------|
| **Language** | Elixir/JS/Go | Go | **Go 🚀** |
| **RAM at rest** | ~1.5 GB | ~20-50 MB | **< 30 MB ✅** |
| **Binary size** | ~2 GB (Images) | ~40 MB | **< 15 MB 💎** |
| **Database** | Postgres | SQLite | **Postgres (Native) 🐘** |
| **Realtime** | WebSockets | SSE | **SSE (Scalable) ⚡** |
| **Deployment** | Complex | Single Binary | **Single Binary 📦** |

---

## ✨ Key Features

- **🚀 Extreme Performance**: Built with Go and Echo. Zero overhead.
- **🏗️ Meta-Schema Ops**: Create tables and fields via API at runtime. No migrations needed.
- **🔐 Auth & Security**: JWT-based auth with granular ACL (Public/Auth/Admin).
- **⚡ SSE Realtime**: Native Server-Sent Events for instant UI updates.
- **🛠️ TypeGen CLI**: Generate TypeScript interfaces directly from your DB schema.
- **📂 File Storage**: Built-in local file management.
- **🛡️ IP Firewall**: Enterprise-grade IP Whitelist/Blacklist with auto-expiration.
- **🧙 Setup Wizard**: Secure first-run experience with auto-login and "Fortress Mode".
- **🔒 Hardened**: Rate limiting, security headers, SQL injection defense, and strict validation.

---

## � The Perfect Circle (DX-First)

OzyBase closes the gap between Backend and Frontend with a seamless 3-step workflow:

1. **Auto-Config Backend**: Embedded PostgreSQL starts automatically. No Docker, no external DB needed.
2. **Dynamic Dashboard**: Tables created in the UI are immediately available. No migrations to write.
3. **Type-Safe Frontend**: Run `gen-types` to get full TypeScript autocomplete in your app via our official SDK.

---

## �🚀 Quick Start (in 10 seconds)

### 1. Requirements: Just Go! 🚀
OzyBase is **Install to Play**. You only need [Go 1.22+](https://go.dev/) installed on your machine.
OzyBase now includes an **Embedded PostgreSQL** engine, so you don't need to install or configure any database manually.

### 2. Run the Engine
```bash
# Clone and run
git clone https://github.com/Xangel0s/OzyBase
cd OzyBase
go run ./cmd/ozybase
```
*The first run will download the PostgreSQL engine automatically (~20MB). Subsequent starts are instant.*

### 3. Alternative: Run with your own DB
If you prefer to use an existing PostgreSQL instance:
```bash
export DATABASE_URL=postgres://user:pass@host:port/dbname
go run ./cmd/ozybase
```

### 4. Create your first collection
```bash
curl -X POST http://localhost:8090/api/collections \
  -H "Content-Type: application/json" \
  -d '{"name": "posts", "schema": [{"name": "title", "type": "text"}]}'
```

---

## 💎 OzyBase SDK (The Developer Expirience)

We provide a **Supabase-style** JavaScript/TypeScript SDK for seamless integration.

```typescript
import { createClient } from '@OzyBase/sdk'

const OzyBase = createClient('http://localhost:8090')

// Full Autocomplete & Type Safety!
const { data, error } = await OzyBase
  .from('products')
  .select('*')
  .eq('active', true)

// Realtime just works
OzyBase.channel('products').on('INSERT', (payload) => {
  console.log('New product!', payload.new)
}).subscribe()
```

---

## 📚 Documentation

- [📊 Project Status & Roadmap](./PROJECT_STATUS_MASTER.md)
- [🛠️ JS/TS SDK](https://github.com/Xangel0s/-js-sdk)
- [🏗️ Tutorial: My First App](./docs/tutorial.md)
- [📜 API Spec (OpenAPI)](./docs/openapi.yaml)

---

## 🛠️ Development Progress

- [x] **Phase 0**: Foundation ✅
- [x] **Phase 1**: Security & Hardening ✅
- [x] **Phase 2**: JavaScript/TypeScript SDK ✅
- [x] **Phase 3**: Type Generation CLI ✅
- [x] **Phase 4**: Linux Production Optimization ✅
- [x] **Phase 5**: Documentation & Testing ✅

---

Developed with ❤️ by **Xangel0s**.  
**OzyBase: Power in a single binary.** 🛡️🚀



