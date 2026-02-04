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
- **🛡️ Hardened**: Rate limiting, security headers, and strict validation out of the box.

---

## 🚀 Quick Start (in 30 seconds)

### 1. Requirements
- PostgreSQL 14+

### 2. Environment Setup
```bash
cp .env.example .env
# Edit .env with your DB credentials
```

### 3. Run the Engine
```bash
# Option A: Go Run
go run ./cmd/OzyBase

# Option B: Optimized Binary
go build -ldflags="-s -w" -o OzyBase ./cmd/OzyBase
./OzyBase
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

- [📖 General Roadmap](./INTEGRATION_ROADMAP.md)
- [🛠️ SDK Reference](./sdk/js/README.md)
- [🛡️ Security Hardening](./SECURITY_HARDENING.md)
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



