# Cambios desarrollados: RLS + corrección de tipo de dato (varchar)

**Fecha:** 9 de abril de 2026  
**Proyecto:** OzyBase / BAAS

## 1) Correcciones de RLS y UX de políticas

### 1.1 Acción directa de remediación RLS desde banner global
- Se cambió la acción del banner global para ejecutar directamente:
  - `POST /api/project/security/rls/closeout`
- Antes: solo navegaba a otra vista.
- Ahora: aplica cierre/corrección de cobertura RLS en el flujo actual.

**Archivo:** `frontend/src/components/Layout.tsx`

---

### 1.2 Banner del Table Editor solo cuando hay problema real
- El banner dejó de mostrarse por metadatos genéricos y ahora se muestra solo cuando existe un issue real de RLS para la tabla actual reportado por salud del proyecto (`/api/project/health`).
- Se ajustó el mensaje a **"Runtime Policy Issue"** para mayor claridad.

**Archivos:**
- `frontend/src/components/TableEditor.tsx`
- `frontend/src/utils/healthIssues.ts`
- `frontend/src/components/Layout.tsx`

---

### 1.3 (Relacionado al flujo de edición) Persistencia de Primary Key en modo Edit
- Se agregó soporte real para actualizar PK en edición de tabla.
- Nuevo endpoint:
  - `PATCH /api/tables/:name/primary-key`
- El modal de edición ahora aplica el diff de PK y lo persiste en backend.

**Archivos:**
- `internal/data/schema.go` (`SetTablePrimaryKey`)
- `internal/api/collections.go` (`UpdateTablePrimaryKey`)
- `cmd/ozybase/main.go` (registro de ruta)
- `frontend/src/components/CreateTableModal.tsx`

---

## 2) Bug corregido: selecciono `varchar` y luego aparece `text`

## Problema reportado
Al crear una columna como `varchar`, luego en UI/schema aparecía como `text`.

## Causa raíz
Postgres reporta `varchar` como `character varying` en `information_schema.columns.data_type`.  
El mapper no contemplaba ese literal y caía al fallback `text`.

## Corrección aplicada
- Se actualizó el mapper para convertir `CHARACTER VARYING` a `varchar`.

**Archivo:** `internal/data/schema.go` (`mapPostgresTypeToOzy`)

## Cobertura de prueba agregada
- Nuevo test de regresión:
  - `TestMapPostgresTypeToOzy_CharacterVaryingUsesVarchar`

**Archivo:** `internal/data/schema_sql_test.go`

## Validación funcional
- Reproducción ejecutada por API:
  1. Crear tabla con columna `title` tipo `varchar`.
  2. Consultar `GET /api/schema/:name`.
  3. Resultado esperado y obtenido tras fix: `title.type = "varchar"`.

---

## 3) Impacto
- Menos fricción en gestión de políticas RLS y menos falsos positivos visuales.
- Flujo de edición de tablas más consistente (PK realmente persistida).
- Coherencia entre tipo seleccionado (`varchar`) y tipo mostrado en el editor.

---

## 4) Notas
- Después de cambios backend, se reinició servicio local para tomar el fix:
  - Backend: `http://127.0.0.1:8090`
  - Frontend: `http://localhost:5342`

---

## 5) Corrección adicional: pestañas “pegadas” del Table Editor entre proyectos/backends

### Síntoma
- Al cambiar de proyecto/workspace (o backend con dataset distinto), el Table Editor podía mostrar tabs de tablas del entorno anterior.

### Causa raíz
- El hook de tabs usaba un `localStorage` global (`ozy_open_tabs`) sin scope por workspace y sin validar si esas tablas existen en el dataset actual.

### Corrección
- Se aplicó scope por workspace para persistencia de tabs.
- Se agregó saneamiento automático:
  - elimina tabs que no existen en `tables` actuales,
  - limpia `selectedTable` si ya no existe,
  - evita seleccionar tablas inexistentes.

**Archivos:**
- `frontend/src/hooks/useTableTabs.ts`
- `frontend/src/components/AppShell.tsx`

### Impacto
- Se evita contaminación de estado entre contextos.
- Se conserva el comportamiento “Supabase-like” del editor, pero con estado aislado por proyecto.

---

## 6) Aclaración sobre error de VSCode/go (`main redeclared`)

### Síntoma
- Diagnósticos `DuplicateDecl` en archivos dentro de `tmp/` (`main redeclared in this block`).

### Causa
- `tmp/` contiene múltiples scripts de diagnóstico con `package main` y `func main()` en la misma carpeta.
- `gopls` los analiza como un solo paquete y reporta colisión.

### Mitigación sin afectar runtime
- Se excluyó `tmp/` del análisis de `gopls`.

**Archivo:** `.vscode/settings.json` (`gopls.directoryFilters: ["-tmp"]`)

### Impacto
- Limpia ruido del IDE sin tocar lógica de frontend/backend ni la operación del sistema.

---

## 7) Corrección ampliada de tipos (más allá de `varchar`)

### Problema detectado
Al validar más tipos de datos en flujo real de creación/lectura de esquema, había conversiones incorrectas por cómo `information_schema` reporta tipos:

- `smallint` -> terminaba como `text`
- `time with/without time zone` -> terminaba como `text`
- `timestamp with time zone` -> terminaba como `timestamp`
- `ARRAY` de enteros (por `udt_name`) -> terminaba como `text_array`

### Causa raíz
- El mapeo dependía casi solo de `data_type` textual y no consideraba correctamente:
  - variantes literales de `information_schema` (ej. `smallint`, `timestamp with time zone`),
  - ni `udt_name` para desambiguar arrays.

### Corrección aplicada
- Se unificó la normalización de tipos con soporte para `udt_name`.
- Se actualizó lectura de esquema para incluir `udt_name` en:
  - `GetTableSchema`
  - `GetDatabaseSchema`
  - `loadCollectionSchemaFromDatabase` (sync de metadata de colecciones)
- Se agregaron reglas explícitas para:
  - `smallint -> int2`
  - `time without time zone -> time`
  - `time with time zone -> timetz`
  - `timestamp with time zone -> timestamptz`
  - `ARRAY + udt_name _int* -> int_array`

**Archivos:**
- `internal/data/schema.go`
- `internal/api/collections.go`
- `internal/data/schema_sql_test.go`

### Validación
- `go test ./internal/data ./internal/api` ✅
- Repro funcional con tabla temporal de matriz de tipos (26 columnas) usando `GetTableSchema` ✅

### Impacto
- Mayor consistencia “tipo Supabase” entre tipo elegido y tipo mostrado/guardado.
- Menor deriva entre metadata (`_v_collections.schema_def`) y `/api/schema/:name`.
- No afecta la gestión actual: solo corrige normalización en lectura/sincronización de tipos.

---

## 8) Verificación integral de módulos: Storage + Edge Functions + Realtime

### Alcance validado (flujo de usuario)
- **Storage**:
  - listar buckets
  - crear bucket
  - editar bucket
  - subir archivo (session + stream)
  - listar archivos
  - descargar archivo
  - eliminar archivo
  - eliminar bucket
- **Edge Functions**:
  - listar
  - crear
  - invocar
  - eliminar
- **Realtime Engine**:
  - habilitar trigger realtime por colección
  - validar estado del engine (`/api/project/realtime/status`)
  - validar recepción real de evento SSE por `INSERT` en `/api/realtime`

### Ajustes aplicados durante la verificación
1. **Storage UI – método HTTP de edición de bucket**
   - Se detectó incongruencia: el frontend enviaba `PUT` y el backend expone `PATCH` para actualizar bucket.
   - **Fix:** cambio a `PATCH` en el módulo Storage.
   - **Archivo:** `frontend/src/components/StorageManager.tsx`

2. **Edge Functions UI – acción de borrado**
   - Se agregó acción de eliminar función desde la tabla de funciones (botón y handler).
   - **Archivo:** `frontend/src/components/EdgeFunctions.tsx`

### Validación técnica ejecutada
- Script de verificación end-to-end:
  - `tmp/verify_storage_edge_realtime.go`
- Resultado:
  - **Storage:** PASS
  - **Edge Functions:** PASS
  - **Realtime Engine:** PASS
  - Confirmación de evento SSE `INSERT` recibido correctamente.
