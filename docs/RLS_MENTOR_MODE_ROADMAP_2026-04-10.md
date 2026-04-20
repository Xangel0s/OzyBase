# RLS Mentor Mode - Cierre de fase y rumbo (2026-04-10)

## Resumen ejecutivo
Se completaron los cambios para alinear OzyBase con el comportamiento base de Supabase en seguridad de tablas:

- RLS activo con 0 politicas ahora se interpreta como estado seguro (tabla cerrada por defecto), no como vulnerabilidad.
- Se elimino ruido de falsos positivos en salud/cobertura y en experiencia visual.
- Se simplifico la UX para pasar de alertas punitivas a guia de configuracion.
- Se agrego capa de compatibilidad para expresiones tipo Supabase (`auth.uid()` y `auth.jwt()`) en bases nuevas.
- Se elimino la inyeccion implicita de `id` en creacion de tablas para respetar esquema definido por el usuario.

## Cambios implementados (ultimo bloque)

### 1) Backend - compatibilidad y validacion RLS
- Se agrego bootstrap de compatibilidad antes de crear/validar politicas:
  - `CREATE SCHEMA IF NOT EXISTS auth`
  - funciones `auth.jwt()` y `auth.uid()`
  - roles `anon` y `authenticated` si no existen
- Se integro el bootstrap en flujos:
  - creacion de coleccion
  - actualizacion de configuracion RLS
  - enforce/closeout de cobertura
- La validacion SQL acepta helpers `auth.uid/auth.jwt` en escenarios donde no estaban inicializados todavia, evitando 500 falsos por entorno frio.

### 2) Backend - semantica de cobertura
- Se cambio el criterio de brecha estructural a modelo de aislamiento:
  - RLS OFF => brecha/vulnerable
  - RLS ON => estado seguro/cerrado por defecto
- En cobertura, acciones faltantes ya no se tratan como brecha cuando RLS esta activo.

### 3) Frontend - cambio de tono y accion
- Banner global y textos actualizados para hablar de RLS desactivado en lugar de "faltan politicas" como riesgo critico.
- En Permission Manager:
  - "Vulnerable actions" -> "RLS disabled"
  - "Patch Security" -> "Enable RLS"
  - mensajes de protocolo cambiados a mensajes de guia de acceso.
- En Create Table:
  - flujo simple primero (quick protection)
  - custom/SQL bajo demanda
  - sin forzar politicas al crear
  - helper contextual para owner column.

### 4) SQL schema behavior
- Se removio la inyeccion automatica de columna `id` cuando no fue definida por el usuario.
- Se agrego test de regresion para evitar reintroducir esa inyeccion.

## Archivos principales modificados
- `frontend/src/components/CreateTableModal.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/components/PermissionManager.tsx`
- `frontend/src/components/TableEditor.tsx`
- `frontend/src/components/EditColumnModal.tsx`
- `internal/api/collections.go`
- `internal/api/rls_coverage.go`
- `internal/data/schema.go`
- `internal/data/schema_rls_test.go`
- `internal/data/schema_sql_test.go`

## Validaciones realizadas
- `go test ./internal/api ./internal/data` -> OK
- `npm run build` (frontend) -> OK
- Reinicio backend + health check `GET /api/health` -> 200

## Rumbo inmediato (siguiente fase)

### Objetivo de producto
Consolidar el modo "mentor": guiar configuracion de acceso sin ruido, sin alertas falsas, y con mensajes accionables por contexto.

### Plan corto (iteracion siguiente)
1. Completar copy y estado visual en todos los puntos de UI donde aun aparezca terminologia de cobertura punitiva.
2. Estandarizar un solo estado semantico:
   - `RLS_DISABLED` (riesgo)
   - `RLS_ENABLED_LOCKED` (seguro por cierre)
   - `RLS_ENABLED_WITH_POLICIES` (seguro con acceso definido)
3. Agregar telemetria minima de conversion UX:
   - activar RLS
   - aplicar quick preset
   - abrir editor custom
4. Expandir pruebas E2E de creacion de tabla con presets y con RLS sin politicas.

## Proceso operativo recomendado
1. Crear tabla con RLS ON y sin politicas.
2. Verificar que no aparezca alerta critica en dashboard/policies.
3. Aplicar preset rapido y verificar creacion de politicas sin 500.
4. Validar owner helper (`Add column`) cuando corresponda.
5. Ejecutar regression suite de API/UI antes de merge.

## Riesgos conocidos y mitigacion
- Riesgo: confundir estado "sin politicas" con inseguro.
  - Mitigacion: copy explicito "acceso denegado por defecto".
- Riesgo: entornos nuevos sin helpers auth.
  - Mitigacion: bootstrap de compatibilidad ejecutado en flujos RLS.
- Riesgo: ruido por migraciones temporales de prueba.
  - Mitigacion: no incluir migraciones ad-hoc en commits de producto.

## Criterio de salida de fase
- No hay 500 al crear tabla con quick presets.
- No hay alertas criticas falsas cuando RLS esta ON y politicas=0.
- RLS OFF sigue marcado como riesgo real.
- Build frontend y tests API/Data en verde.
