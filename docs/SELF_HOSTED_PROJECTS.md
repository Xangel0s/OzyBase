# Self-Hosted Projects in OzyBase

This document explains how `workspace` works internally and why the self-hosted UI presents it as `Project`.

## 1. Core Positioning

In self-hosted OSS, a project is:
- a logical scope
- not a new PostgreSQL database
- not an automatically provisioned schema
- not an automatically provisioned physical bucket

That is deliberate.

The self-hosted contract is:
- one OzyBase installation
- one shared PostgreSQL runtime
- one shared storage runtime
- multiple projects scoped by context, membership, keys, and limits

## 2. What a Project Actually Scopes

Projects currently scope:
- memberships and team access
- collection metadata
- API keys
- saved views
- dashboard context
- usage counters
- project limits and warnings

Projects do not automatically create:
- another PostgreSQL database
- another schema
- another storage bucket
- another region deployment

## 3. Request Flow

When a user selects a project:
1. the frontend stores `ozy_workspace_id`
2. frontend requests include `X-Workspace-Id`
3. backend validates membership and role
4. handlers respond or enforce behavior inside that project scope

Relevant implementation surfaces:
- [frontend/src/components/WorkspaceManager.tsx](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/frontend/src/components/WorkspaceManager.tsx)
- [frontend/src/components/WorkspaceSettings.tsx](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/frontend/src/components/WorkspaceSettings.tsx)
- [frontend/src/components/Settings.tsx](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/frontend/src/components/Settings.tsx)
- [internal/api/workspace.go](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/internal/api/workspace.go)
- [internal/core/workspace.go](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/internal/core/workspace.go)
- [internal/core/workspace_limits.go](C:/Users/lunax/OneDrive/Documentos/broo/OzyBase-Core/internal/core/workspace_limits.go)

## 3.1 Runtime vs Control Plane Ownership

The self-hosted product is easier to reason about when this split stays explicit:

| Area | Runtime plane | Control plane |
| --- | --- | --- |
| Auth execution | Yes | No |
| Table/record CRUD | Yes | No |
| SQL execution | Yes | No |
| Storage operations | Yes | No |
| Realtime delivery | Yes | No |
| Function invocation | Yes | No |
| Project lifecycle | No | Yes |
| Members and roles | No | Yes |
| Usage accounting | No | Yes |
| Limits and warnings | Runtime consumes rules | Yes |
| Capabilities contract | Runtime reads it | Yes |
| Future provisioning | No | Yes |

## 4. Why This Model Makes Sense in Self-Hosted

If every project created a new physical DB in self-hosted mode, OzyBase would have to own:
- DB provisioning
- connection management per project
- migrations per project
- backup/restore per project
- pooling and secrets per project

That is a cloud or enterprise control-plane problem, not a good default for OSS self-hosted installs.

The current project model gives real value without over-promising:
- separation for teams
- separation for keys
- separation for metadata
- separation for quotas
- one admin surface for many projects

## 5. Example: One Installation, Three Projects

Imagine one self-hosted install serving:
- `Marketing Site`
- `Internal Ops`
- `Client Portal`

All three use the same PostgreSQL server.

What differs per project:
- members
- API keys
- collection metadata tracked by project
- saved table views
- usage and limits

What stays shared:
- physical PostgreSQL instance
- runtime process
- deployment topology
- storage provider

## 6. What Comes Later in Cloud / Enterprise

These are not part of the current self-hosted OSS contract:
- dedicated schema per project
- dedicated DB per project
- managed billing
- managed PITR UX
- read replicas UI
- failover UX

Those belong to a cloud / enterprise roadmap, not to the self-hosted baseline.

## 7. Next Structural Step

The recommended next step is not to remove `workspace`.

It is to keep `Project` as the stable product term and, in a later phase, extract governance concerns into a more explicit control-plane module so runtime features keep consuming one source of truth for:
- capabilities
- usage
- limits
- project lifecycle policy
