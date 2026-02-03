# OzyBase Project Roadmap

This document outlines the strategic direction for OzyBase development.

## 🧠 Phase 1: The AI Era (Immediate Priority)
**Objective**: Transform OzyBase into the default "AI-Native Database Backend".
- [ ] **MCP Server (Machine Context Protocol)**:
  - Create a dedicated MCP server (`cmd/mcp-server`) that exposes the database schema and query capabilities to AI agents (Claude, Cursor, Windsurf).
  - *Goal*: Allow developers to simply say "Add a users table" to their AI editor, and have OzyBase execute it safely.
- [ ] **Natural Language Querying (NLQ)**:
  - Integrate a local LLM or API bridge to convert plain English to SQL directly in the `SQLEditor`.
- [ ] **Vector Search Support**: Native support for `pgvector` to store embeddings for AI RAG applications.

## ⚡ Phase 2: Edge & Performance (Q2 2026)
**Objective**: Improve the "Edge Functions" capability to rival industry leaders.
- [ ] **WASM Runtime**: Support compiling Go/Rust/Python functions to WebAssembly for sandboxed, high-speed execution.
- [ ] **Global Read Replicas**: Architecture design for multi-region read scaling.
- [ ] **Realtime 2.0**: Upgrade from polling/basic websockets to a robust Pub/Sub system (possibly integrating NATS or Redis Stream).

## 🛡️ Phase 3: Enterprise Fortress (Q3 2026)
**Objective**: Hardened security for production banking/fintech use cases.
- [ ] **Audit Log Tamper-Proofing**: Chain audit logs cryptographically.
- [ ] **Advanced SIEM**: Native integration with Splunk/Datadog log formats.
- [ ] **Compliance Reports**: One-click PDF generation for SOC2/GDPR compliance status based on system config.

## 🎨 Phase 4: UI/UX Excellence
- [ ] **Visual Schema Builder**: Drag-and-drop table relationship editor (replaces the read-only Schema Visualizer).
- [ ] **Mobile Admin App**: React Native wrapper for on-the-go management.
