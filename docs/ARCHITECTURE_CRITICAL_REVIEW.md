# OzyBase Architecture Critical Review

This document is intentionally candid.

Its purpose is not to celebrate feature count. Its purpose is to answer the harder question a senior architect, operator, or technical founder will ask:

> Is OzyBase predictable enough to operate, scale, evolve, and isolate over the next 12-24 months?

The answer today is:

- `Yes` for a serious self-hosted single-installation product.
- `Not yet` for a full Supabase-equivalent cloud platform.

That is not a weakness if the product is positioned correctly. It becomes a weakness only if roadmap and messaging over-promise beyond the architecture.

## 1. Executive Verdict

OzyBase already has a credible runtime:
- Go backend
- embedded admin surface
- PostgreSQL data plane
- storage
- auth
- realtime
- MCP / AI runtime
- self-hosted deployment story

That is enough for real apps.

What still separates it from a mature platform competitor is not the number of screens. It is the maturity of:
- product boundaries
- control plane separation
- runtime predictability
- upgrade discipline
- performance budgets
- isolation guarantees

If OzyBase wants to become stronger than a "Supabase-inspired admin surface", it should stop optimizing for surface area and start optimizing for operational clarity.

## 2. What Is Strong Today

### 2.1 Self-hosted positioning is finally coherent

The current `Project` model in self-hosted is defensible:
- one installation
- one shared physical PostgreSQL database
- multiple logical projects
- scoped members, keys, metadata, MCP, usage, and limits

That is a realistic OSS contract.

### 2.2 The product already solves real operator pain

OzyBase is not a toy dashboard anymore. It already covers:
- setup and bootstrap
- auth and admin flows
- table and schema management
- storage administration
- realtime
- observability
- usage and quota enforcement
- MCP-oriented access

For self-hosted teams, that is real value.

### 2.3 Coolify-first is a smart strategic wedge

Trying to beat Supabase at "generic cloud platform breadth" is expensive.

Trying to become the best self-hosted BaaS for:
- Coolify
- one-click deployment
- strong admin UX
- AI/MCP-native runtime

is much more defensible.

## 3. The Weakest Points Today

### 3.1 Product surface area is growing faster than architectural boundaries

The system already exposes many modules:
- auth
- database
- storage
- security
- observability
- functions
- MCP
- vectors
- integrations
- admin tooling

That is impressive, but it creates a real risk:
- features begin sharing assumptions through the dashboard instead of contracts
- runtime logic leaks into UI decisions
- more modules depend on global state than they should
- regressions become harder to localize

This is the classic "wide surface, shallow boundaries" problem.

### 3.2 `Workspace` vs `Project` is improved, but still semantically fragile

The current self-hosted model is correct, but the product still carries semantic residue:
- some code paths still think in `workspace`
- some UX paths think in `project`
- some capabilities exist only as future intent
- some operators may still infer physical isolation where only logical scoping exists

This is not just naming polish. It affects:
- user expectation
- roadmap clarity
- enforcement design
- future cloud migration strategy

### 3.3 There is not yet a real control plane

This is the biggest strategic gap.

OzyBase has a strong runtime/admin plane. It does not yet have a mature control plane for:
- provisioning
- topology management
- lifecycle orchestration
- billing/metering as a platform concern
- managed backups / PITR / replicas
- cloud-only capability negotiation

Without that separation, adding more features can make the product feel richer while the architecture becomes harder to operate.

### 3.4 The frontend is powerful, but still heavier than it should be

The UI is already useful, but a senior frontend/platform review would still call out:
- Monaco cost
- heavy route surfaces
- large composite pages
- repeated state logic
- interaction complexity in admin-heavy modules

The issue is not that the UI is "too advanced". The issue is that advanced UI without clear performance budgets eventually becomes a maintenance tax.

### 3.5 The real question is predictability, not feature count

A senior architect will ask:
- Can upgrades be repeated safely?
- Are migrations predictable?
- Can quotas be enforced consistently?
- Is isolation behavior explicit?
- Is failure handling understandable?
- Can the product be operated by a team that did not build it?

This is where platforms win or lose over 12-24 months.

## 4. What Would Make OzyBase Superior

OzyBase should not try to win by copying all of Supabase.

It should win by becoming better in a narrower, clearer identity:

- self-hosted-first
- Coolify-native
- strong admin plane
- MCP/AI-native operational surface
- project-scoped governance
- predictable runtime behavior

That means saying "no" to some kinds of growth.

## 5. Hard Decisions Required

### 5.1 Treat `Project` as the product contract

For self-hosted:
- `Project` is a logical scope.
- It is not a new DB.
- It is not automatic physical isolation.
- It is the anchor for members, keys, usage, limits, MCP, and admin context.

The system should keep `workspace` as an internal technical term only where needed.

### 5.2 Separate runtime plane from control plane

The current runtime can serve real apps.

The next maturity layer should be a clear split:

- `runtime plane`
  - auth
  - data access
  - storage
  - realtime
  - functions
  - MCP

- `control plane`
  - projects
  - metering
  - limits
  - backup orchestration
  - future provisioning
  - topology/capabilities

This split matters even in self-hosted because it reduces coupling before cloud/enterprise arrives.

### 5.3 Define explicit capability negotiation by deployment profile

The product should not guess what a deployment can do.

Every environment should expose clear capabilities such as:
- `logical_shared_db`
- `managed_billing=false`
- `supports_dedicated_schema=false`
- `supports_failover_ui=false`

That keeps UI honest and prevents dead CTAs.

### 5.4 Put performance on a budget

The frontend should have explicit budgets for:
- initial route weight
- Monaco/editor hydration cost
- table/grid render cost
- modal complexity
- dashboard module chunk size

Without budgets, complexity always wins.

## 6. Workstreams To Close the Weak Points

### Workstream A: Product Boundaries and Module Ownership

Goal:
- reduce coupling and define ownership per bounded context

Actions:
- define module boundaries: `auth`, `data`, `storage`, `realtime`, `security`, `observability`, `project-governance`
- document allowed dependencies between modules
- stop adding cross-module UI shortcuts without API contracts
- introduce deprecation policy for unstable surfaces

Done when:
- every major module has a clear owner, scope, and contract
- new features do not require touching unrelated admin areas by default

### Workstream B: Project Semantics

Goal:
- make `Project` behavior explicit and unambiguous

Actions:
- rename surface UX consistently to `Project`
- keep `workspace` internal where needed
- publish a scope matrix for what is and is not project-scoped
- add capability descriptors everywhere the UI could imply physical provisioning

Done when:
- an operator cannot reasonably confuse `Project` with `physical database`

### Workstream C: Control Plane Foundations

Goal:
- prepare the platform for growth without faking cloud maturity

Actions:
- centralize usage accounting
- centralize limits and alert thresholds
- centralize capability exposure
- centralize project lifecycle rules

Later cloud-only extensions:
- schema provisioning
- bucket provisioning
- dedicated database provisioning
- replicas
- PITR

Done when:
- runtime concerns and control-plane concerns are separated in both code and product behavior

### Workstream D: Frontend Weight and Predictability

Goal:
- make the dashboard fast enough to stay operable as modules grow

Actions:
- route-level code splitting
- delayed Monaco loading
- common dense-layout primitives
- stronger virtualization in data-heavy areas
- performance budgets in CI for critical routes

Done when:
- no critical admin route feels disproportionately heavy relative to what it renders

### Workstream E: Operability Over 12-24 Months

Goal:
- make the product maintainable by teams, not only by its original builder

Actions:
- codify upgrade and migration policy
- document compatibility guarantees per release
- keep disaster drills and restore drills on a cadence
- define SLOs for self-hosted recommended deployments
- document tenant isolation guarantees and non-guarantees clearly

Done when:
- operators can explain failure modes, upgrade behavior, and scoping rules without reading source code

## 7. What To Build Next, In Order

### Tier 1: Must-have

1. Project semantic cleanup across all UX and API docs
2. Control-plane capability contract
3. Usage/metering/limits hardening
4. Frontend performance budget and Monaco deferral
5. Upgrade compatibility and migration guarantees

### Tier 2: Strong platform leverage

1. Public JS/TS SDK
2. Public CLI
3. Realtime product layer:
   - channels
   - presence
   - broadcast
   - client-facing inspector
4. Search-index backfill for legacy tables

### Tier 3: Cloud / enterprise track

1. Dedicated schema per project
2. Dedicated bucket or managed prefixing model
3. Managed PITR UX
4. Read replicas UI
5. Failover UX
6. Dedicated database provisioning

## 8. What A Senior Architect Would Probably Say

Positive:
- "The direction is good."
- "The self-hosted positioning is much stronger than most clones."
- "The runtime has enough substance to support real applications."

Critical:
- "Stop expanding surface area faster than platform discipline."
- "Define the product contract for projects once and enforce it everywhere."
- "Do not confuse admin-plane maturity with control-plane maturity."
- "Do not measure success by the number of modules."
- "Make the system predictable before making it broader."

## 9. Success Metrics

The product is getting stronger if these improve:

### Platform clarity
- zero UI paths that imply `Project = physical DB` in self-hosted
- every deployment profile exposes explicit capabilities

### Runtime predictability
- no upgrade requires undocumented manual intervention
- restore drills and rollback drills stay green
- quota enforcement is consistent across writes/imports/uploads

### Frontend discipline
- critical routes stay within defined JS bundle budgets
- Monaco and heavy editors do not impact non-editor routes
- dense desktop layouts remain operable at `1920x1080 @ 150%`

### Product maturity
- operators can onboard and manage multiple projects from docs alone
- public SDK/CLI reduce dependence on dashboard-only workflows

## 10. Non-Goals

These should not be treated as immediate self-hosted OSS goals:
- pretending each project is its own PostgreSQL deployment
- exposing cloud-only features as disabled placeholders
- chasing full Supabase parity in every category at once
- prioritizing more modules over stronger contracts

## 11. Recommended Positioning

The strongest honest positioning today is:

> OzyBase is a self-hosted-first BaaS optimized for Coolify-style deployment, project-scoped governance, admin-heavy operations, and AI/MCP-native workflows.

That is stronger than being a vague "Supabase clone".

## 12. Bottom Line

OzyBase is already good enough to power real self-hosted applications.

To become superior, it should not mainly add more screens.

It should become:
- more explicit
- more bounded
- more predictable
- more operable
- more disciplined about what belongs to self-hosted OSS vs cloud/enterprise

That is the path from "impressive product surface" to "credible platform architecture".
