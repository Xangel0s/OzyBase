# Project Semantics and Control Plane Validation Plan

This document turns the architectural critique into the final structural validation plan for the self-hosted product.

The intent is simple:

- close the remaining semantic ambiguity around `workspace` / `Project`
- separate `runtime plane` from `control plane` clearly enough to keep OzyBase predictable over time

If these two tracks are closed well, the remaining work is mostly:
- maintenance
- UI/UX polish
- performance tuning
- documentation expansion

## 1. Scope

This plan is for:
- self-hosted OSS
- single-installation runtime
- shared physical PostgreSQL database
- project-scoped governance, limits, keys, metadata, and runtime context

This plan is not for:
- dedicated database per project
- automatic schema provisioning
- cloud-only control plane
- managed PITR/replicas/failover product features

## 2. Why These Are the Last Structural Blockers

### 2.1 Project semantics

If `Project` is not semantically closed, the system keeps leaking confusion into:
- UI copy
- API behavior
- storage scoping
- limits enforcement
- admin expectations
- future cloud roadmap

### 2.2 Runtime vs control plane

If the product keeps mixing runtime logic with project-governance logic, the system becomes harder to:
- scale
- upgrade
- test
- document
- operate by a team that did not build it

That is why these two areas are more important than adding more modules.

## 3. Final Closure Order

1. Close `Project` semantics everywhere
2. Close `runtime plane` vs `control plane` boundaries
3. Re-run full validation
4. Treat the rest as maintenance and polish

## 4. Track A: Project Semantics Closure

## Goal

`Project` must mean exactly one thing in self-hosted OSS:

> A logical scope for people, metadata, keys, usage, limits, and dashboard context inside one shared installation.

It must not imply:
- another PostgreSQL database
- another schema
- another physical storage bucket
- another region deployment

## Required Product Decisions

- Use `Project` as the user-facing term everywhere possible.
- Keep `workspace` as an internal technical term only where needed.
- Make self-hosted copy explicit:
  - `Project scopes access, metadata, keys, and limits`
  - `It does not provision another PostgreSQL database in self-hosted mode`
- Remove or hide any UI that suggests automatic physical provisioning in self-hosted.

## Validation Checklist

### UI

- Header, settings, onboarding, and management views say `Project`, not `workspace`, unless the term is explicitly technical.
- No self-hosted screen suggests `Project = physical DB`.
- No cloud-only provisioning CTA appears in self-hosted.

### API

- `GET /api/project/info` exposes capabilities that make the deployment contract explicit.
- `GET /api/workspaces/:id/usage`
- `GET /api/workspaces/:id/limits`
- `PATCH /api/workspaces/:id/limits`

These must behave as project-governance APIs, not provisioning APIs.

### Scope behavior

The following must remain project-scoped and verifiable:
- members
- API keys
- collection metadata
- saved views
- usage
- limits

### Non-goals must stay explicit

The following must remain false in self-hosted OSS:
- dedicated DB per project
- dedicated schema per project
- dedicated physical bucket per project

## Acceptance Criteria

- A new operator can explain `Project` correctly after reading the docs and using the UI once.
- No self-hosted flow implies physical isolation that does not exist.
- Usage, limits, keys, and members are clearly project-scoped in behavior and copy.
- `Project` is no longer semantically ambiguous in the main product surface.

## Recommended Validation Runs

### Manual

1. Create 2 projects
2. Add different members to each
3. Generate different API keys per project
4. Create tables/views in each project context
5. Confirm usage and limits differ per project
6. Confirm UI never implies another DB was created

### Automated

- E2E:
  - create/select/switch project
  - verify scoped members, keys, views, usage
- API:
  - capabilities contract checks
  - limits CRUD checks
  - usage separation checks
- Docs:
  - grep for misleading self-hosted copy related to DB/schema provisioning

## 5. Track B: Runtime Plane vs Control Plane Separation

## Goal

Make the system explicit enough that any engineer can answer:

- what belongs to request-serving runtime behavior
- what belongs to project governance and platform control behavior

## Runtime Plane

Runtime plane should own:
- auth execution
- table/record CRUD
- SQL execution
- storage operations
- realtime execution
- function invocation
- runtime behavior

## Control Plane

Control plane should own:
- project lifecycle
- membership
- usage accounting
- limits configuration
- capability exposure
- audit policy
- future provisioning contracts

## Required Decisions

- Every new feature must declare whether it belongs to runtime plane, control plane, or both.
- Control plane endpoints must not hide runtime mutations unrelated to governance.
- Runtime handlers must consume limits/capabilities from control-plane contracts rather than inventing local policy.
- The UI should reflect this separation:
  - runtime views for operations
  - control views for governance, capability, usage, and limits

## Validation Checklist

### Backend

- Limits enforcement is driven by shared control-plane rules, not duplicated ad hoc logic.
- Capability exposure is centralized and reused.
- Project lifecycle logic is not embedded across unrelated runtime handlers.

### Frontend

- Governance surfaces are grouped clearly:
  - Projects
  - Members
  - Usage & Limits
  - Keys
  - runtime context
- Runtime surfaces do not present governance promises they do not control.

### Architecture

- Control-plane state has a documented source of truth.
- Runtime modules can be described independently of project management.
- Docs reflect the split consistently.

## Acceptance Criteria

- A senior engineer can point to control-plane APIs without reading the whole runtime.
- Limits, capabilities, and project-scoped policy are centralized enough to avoid duplicated behavior.
- A new feature can be placed into the correct plane before implementation starts.
- The product becomes easier to evolve without growing hidden coupling.

## Recommended Validation Runs

### Code review validation

- inspect auth, records, storage, realtime, and project handlers
- verify that project governance rules are not redefined differently in each module

### Integration validation

1. Change a project limit
2. Verify storage enforcement follows it
3. Verify row/import enforcement follows it
4. Verify UI warnings reflect the same source of truth

### Regression validation

- full smoke after any change to:
  - project info
  - limits
  - usage
  - storage enforcement
  - records/import enforcement

## 6. Exit Criteria

These two tracks are considered closed when all of the following are true:

- `Project` is semantically stable in self-hosted
- no self-hosted UX implies physical provisioning
- control-plane contracts are explicit and centralized
- runtime modules consume governance rules instead of redefining them
- docs and tests agree with product behavior

At that point, the remaining work is no longer architectural ambiguity.

It becomes:
- maintenance
- gradual optimization
- frontend polish
- SDK/CLI expansion
- cloud/enterprise track work

## 7. What Comes After Closure

After these two tracks are closed, the next work should be treated as product maturation, not structural rescue:

- performance budgets
- frontend weight reduction
- SDK/CLI publication
- realtime product-layer improvements
- search-index backfill for legacy tables
- cloud/enterprise provisioning work

## 8. Bottom Line

If OzyBase closes:
- `Project semantics`
- `runtime/control plane separation`

then the system becomes structurally credible for long-term self-hosted evolution.

That is the point where remaining work shifts from "fix architectural ambiguity" to "improve and expand a stable platform".
