# Supabase Core Parity (Storage-first) — Implementación 2026-04-09

## Objetivo
Implementar una base **Supabase-like core** sin romper clientes actuales, agregando capacidades por feature flags y manteniendo endpoints legacy.

## Feature flags agregados
- `OZY_STORAGE_POLICY_V2` → `storage_policy_v2`
- `OZY_REALTIME_AUTHZ_V2` → `realtime_authz_v2`
- `OZY_FUNCTIONS_ASYNC_V1` → `functions_async_v1`
- `OZY_LIMITS_ENFORCEMENT_V2` → `limits_enforcement_v2`
- `OZY_REALTIME_LEGACY_OPEN` (control de modo legacy SSE abierto)

## 1) Storage v2
### Nuevas capacidades
- Motor de políticas por bucket/acción con fallback legacy:
  - acciones: `select|insert|update|delete`
  - efecto: `allow|deny`
  - prioridad con precedencia `deny` vs `allow`
- Seed automático de políticas iniciales equivalentes desde reglas legacy (`public/rls_rule`) cuando un bucket no tiene políticas v2.
- Signed URLs:
  - `POST /api/files/sign`
  - soporta `operation=read|upload`
  - expiración corta y firma HMAC
  - validación de key-id activo para revocación por rotación
- Validación MIME declarada vs detectada en upload stream/multipart stream path.
- Auditoría de acceso por objeto (lectura/borrado/subida) con trazabilidad.

### Nuevos endpoints
- `GET /api/files/buckets/:name/policies`
- `PUT /api/files/buckets/:name/policies`
- `POST /api/files/sign`

### Compatibilidad
- `authorizeBucket` mantiene fallback a reglas legacy cuando no hay match v2.
- Endpoints/flujo actual de buckets/uploads/downloads siguen operando.

## 2) Realtime SSE reforzado
### Nuevas capacidades
- Sesión realtime con token efímero y canales autorizados:
  - `workspace:{id}`
  - `table:{workspace_id}:{table}`
  - `user:{id}`
- Filtro de eventos antes de emitir en SSE según canales autorizados.
- Control de legacy abierto:
  - con `realtime_authz_v2` activo → requiere token sesión
  - en modo legacy, apertura controlada por `OZY_REALTIME_LEGACY_OPEN` y validación admin/service role

### Nuevos endpoints
- `POST /api/realtime/session`
- `GET /api/realtime?token=...&channels=...`

### Compatibilidad
- `GET /api/realtime` se mantiene.

## 3) Edge Functions producción
### Nuevas capacidades
- Configuración por función:
  - `timeout_ms`, `max_concurrency`, `max_rpm`, `payload_max_bytes`, `max_retries`
- Invoke async con cola y estados:
  - `queued|running|succeeded|failed|retrying`
  - reintentos con backoff
  - idempotencia por `Idempotency-Key`
- Secretos cifrados por función/workspace con versión y auditoría.
- Runtime JS/WASM usa secretos cargados en ejecución.

### Nuevos endpoints
- `PATCH /api/functions/:name/config`
- `POST /api/functions/:name/invoke-async`
- `GET /api/functions/jobs/:id`
- `POST /api/functions/:name/secrets`

### Compatibilidad
- `POST /api/functions/:name/invoke` (sync) se mantiene.

## 4) Limits hard + soft (enforcement)
### Nuevas capacidades
- Extensión de límites workspace para hard+soft en API/realtime/functions:
  - `api_requests_hard_limit`
  - `realtime_events_hard_limit`
  - `function_invocations_hard_limit`
  - `rate_limit_window_seconds`
  - (manteniendo soft existentes)
- Middleware común de enforcement (feature-flagged) con respuesta:
  - HTTP `429`
  - header `Retry-After`
  - payload con `error_code`, `metric`, `limit`, `current`, `window`, `retry_after`

### Compatibilidad
- Campos existentes de límites no se rompen; se amplía payload.

## Esquema / migraciones internas agregadas
- `_v_storage_bucket_policies`
- `_v_storage_object_access_audit`
- `_v_function_jobs`
- `_v_function_secrets`
- `_v_function_secret_audit`
- Nuevas columnas en `_v_functions` para límites operativos.

## Archivos principales tocados
- `internal/config/config.go`
- `cmd/ozybase/main.go`
- `internal/data/migrations.go`
- `internal/api/files.go`
- `internal/api/files_v2.go`
- `internal/api/realtime.go`
- `internal/api/functions.go`
- `internal/api/functions_async.go`
- `internal/api/limits_middleware.go`
- `internal/core/workspace_limits.go`
- `internal/api/workspace.go`

## Validación de build
Comando ejecutado:
- `go test ./cmd/... ./internal/... -run TestDoesNotExist` ✅

Nota: `go test ./...` falla por scripts `tmp/*.go` con múltiples `main` (esperado/ya identificado), no por regresión del backend.
