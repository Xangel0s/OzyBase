# Plan: PocketBase-Style Setup (Eliminar SetupWizard)

## Top-Level Overview

Reemplazar el SetupWizard de 3 pasos por un flujo tipo PocketBase:

- **Sin wizard en la UI.** El primer arranque imprime las credenciales en la terminal si hay ENV vars (`INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD`), o muestra un banner instruyendo al usuario a correr `./ozybase admin create`.
- **El frontend siempre muestra Login** — nunca el wizard. Si el sistema no está inicializado, el Login muestra un callout informativo.
- **Nuevo grupo de subcomandos `admin`:**
  - `./ozybase admin create --email x --password y` — crea el primer admin (sin interacción si se pasan flags; con prompt si se omiten)
  - `./ozybase admin reset --email x --password y` — resetea la contraseña de un admin existente (reemplaza `reset-admin`)
  - `./ozybase admin delete-all` — elimina todos los admins y deja el sistema sin inicializar (reemplaza binario `cmd/clean-admin`)
- **Tests:** cada subcomando `admin` tiene un test unitario que verifica el comportamiento esperado.
- **El Migration Studio y los modos secure/clean/migrate del wizard se eliminan completamente.** YAGNI.

### Lo que se elimina
- `frontend/src/components/SetupWizard.tsx`
- Lógica de `isSystemInitialized` → SetupWizard en `App.tsx`
- Hook `frontend/src/hooks/useSystemStatus.ts`
- Endpoints `POST /api/system/setup` y `POST /api/system/setup/migration/preview`
- Funciones `SetupSystem`, `PreviewSetupMigration` y tipos auxiliares en `internal/api/system.go`
- Archivo `internal/api/setup_migration.go` y sus 3 archivos de test
- Binarios separados `cmd/reset-password/` y `cmd/clean-admin/` (reemplazados por `admin` subcomandos)

### Lo que se mantiene
- `GET /api/system/status` (el Login lo consume para mostrar el callout)
- `EnsureAdminUser` en `internal/auth/setup.go` (bootstrap por ENV vars, ya funciona bien)
- Toda la lógica de auth, workspaces, JWT, sesiones — sin cambios

---

## Sub-Tasks

---

### Sub-Task 1 — Nuevo grupo de subcomandos `admin`

**Intent**
Crear el grupo `./ozybase admin <subcommand>` con tres operaciones: `create`, `reset`, `delete-all`. Unifican y reemplazan los binarios separados `cmd/reset-password` y `cmd/clean-admin`, y agregan el nuevo `create`. Soportan flags `--email`/`--password` para uso no interactivo (CI/Docker) y prompt cuando se omiten.

**Expected Outcomes**

`admin create`:
```
# Con flags (no interactivo):
./ozybase admin create --email admin@example.com --password SecurePass123!
✓ Admin created: admin@example.com
  Workspace: Primary Project

# Sin flags (prompt):
./ozybase admin create
Enter admin email: admin@example.com
Enter admin password (min 12 chars):
✓ Admin created: admin@example.com

# Si ya existe admin:
✗ Error: an admin account already exists. Use 'admin reset' to change the password.

# Si la password es muy corta:
✗ Error: password must be at least 12 characters
```

`admin reset`:
```
./ozybase admin reset --email admin@example.com --password NewPass456!
✓ Password updated for: admin@example.com

# Si no existe:
✗ Error: no admin found with email admin@example.com
```

`admin delete-all`:
```
./ozybase admin delete-all
⚠ This will delete ALL admin accounts and reset the system to uninitialized.
Type 'yes' to confirm: yes
✓ All admin accounts deleted. System is now uninitialized.
```

- Tests unitarios para cada subcomando que verifican: éxito, error de validación, conflicto.

**Todo List**
- [ ] Extraer la lógica de creación de admin + workspace a una función `createAdminWithWorkspace(ctx, db, email, password string) error` en `internal/auth/setup.go` (reutilizable desde CLI y tests)
- [ ] En `cmd/ozybase/main.go`, función `handleCLI()`: agregar case `"admin"` que parsea el sub-argumento (`create`/`reset`/`delete-all`) con `flag.NewFlagSet` para los flags `--email` y `--password`
- [ ] Implementar `runAdminCreate(db, email, password string)`: validar email y password (>=12), verificar no existe admin, llamar `createAdminWithWorkspace`, imprimir resultado
- [ ] Implementar `runAdminReset(db, email, password string)`: verificar que el usuario existe con `role='admin'`, actualizar `password_hash` con bcrypt(12), imprimir resultado
- [ ] Implementar `runAdminDeleteAll(db)`: pedir confirmación leyendo stdin ("yes"), ejecutar `DELETE FROM _v_users WHERE role='admin'`, imprimir resultado
- [ ] Si `--email` o `--password` se omiten en `create`/`reset`, leer de stdin con prompt (fallback interactivo)
- [ ] Escribir tests en `internal/auth/setup_test.go` (o archivo nuevo `internal/auth/admin_cli_test.go`) que prueben `createAdminWithWorkspace`, incluyendo caso de admin duplicado y password corta, usando una DB de test en memoria o mock

**Relevant Context**
- `cmd/ozybase/main.go` → `handleCLI()` (lines 273-335): patrón existente con `flag.CommandLine` y sub-casos
- `internal/auth/setup.go` → `EnsureAdminUser` (lines 29-90): lógica a refactorizar/extraer
- `internal/api/system.go` → `SetupSystem` (lines 61-242): lógica de workspace creation a reutilizar
- `cmd/reset-password/main.go` y `cmd/clean-admin/main.go`: reemplazar con estos subcomandos
- `internal/data/db.go`: pool de conexión disponible para tests

**Status:** [ ] pending

---

### Sub-Task 2 — Modificar comportamiento de arranque (sin admin)

**Intent**
Cuando el servidor arranca y no hay admin, en lugar de esperar silenciosamente el wizard, imprimir en la terminal un mensaje claro que instruye al usuario a correr `./ozybase admin create`. Eliminar el log actual `"bootstrap wizard"`.

**Expected Outcomes**
- Cuando no hay admin y no hay `INITIAL_ADMIN_EMAIL` en el env, el servidor arranca normalmente (no falla) e imprime:
  ```
  ┌─────────────────────────────────────────────────┐
  │  OzyBase is not initialized.                    │
  │  No admin account found.                        │
  │                                                 │
  │  To create the first admin, run:                │
  │    ./ozybase admin create                       │
  │                                                 │
  │  Or set INITIAL_ADMIN_EMAIL + INITIAL_ADMIN_PASSWORD │
  │  in your .env and restart.                      │
  └─────────────────────────────────────────────────┘
  ```
- El servidor sigue corriendo y sirviendo el Login — no bloquea.
- El banco de datos, realtime, storage, etc. se inicializan igual.

**Todo List**
- [ ] En `cmd/ozybase/main.go`, en el bloque `shouldBootstrapAdminFromEnv()` → else branch, reemplazar `logger.Log.Info().Msg("bootstrap wizard")` por la función `printNotInitializedBanner()`
- [ ] Implementar `printNotInitializedBanner()` que imprime el mensaje con bordes ASCII (patrón igual a `printStartupBanner()`)
- [ ] Verificar que el servidor continúa arrancando sin error aunque no haya admin

**Relevant Context**
- `cmd/ozybase/main.go` lines 120-126: bloque `shouldBootstrapAdminFromEnv()`
- `cmd/ozybase/main.go` lines 212-219: `printStartupBanner()` — patrón de banner a seguir

**Status:** [ ] pending

---

### Sub-Task 3 — Eliminar SetupWizard del frontend

**Intent**
Eliminar completamente el componente `SetupWizard.tsx` y toda la lógica que lo renderiza en `App.tsx`. El frontend siempre muestra el Login como punto de entrada. Si el sistema no está inicializado, el Login muestra un banner informativo con las instrucciones de CLI.

**Expected Outcomes**
- `frontend/src/components/SetupWizard.tsx` eliminado del proyecto.
- `frontend/src/hooks/useSystemStatus.ts` eliminado.
- `App.tsx` sin import ni render de SetupWizard; sin estados `isSystemInitialized`/`setIsSystemInitialized`; sin import de `useSystemStatus`.
- El Login detecta `{ initialized: false }` en `GET /api/system/status` y muestra un callout visible sobre el formulario:

  ```
  ┌─ Sistema no inicializado ──────────────────────┐
  │ No hay cuentas de administrador.               │
  │ Crea el primero desde la terminal:             │
  │                                                │
  │   ./ozybase admin create                       │
  │                                                │
  │ O define INITIAL_ADMIN_EMAIL y                 │
  │ INITIAL_ADMIN_PASSWORD en el .env y reinicia.  │
  └────────────────────────────────────────────────┘
  ```
- El formulario de login está visible y funcional aunque el sistema no esté inicializado (el usuario puede ignorar el callout si ya sabe que no hay admin todavía).
- Una vez que el admin existe, el callout desaparece y el login funciona normalmente.

**Todo List**
- [ ] Eliminar archivo `frontend/src/components/SetupWizard.tsx`
- [ ] Eliminar archivo `frontend/src/hooks/useSystemStatus.ts`
- [ ] En `App.tsx`: quitar `import { useSystemStatus }`, quitar los estados derivados del hook, quitar el bloque `if (!isSystemInitialized)` con el render del wizard, quitar la prop `onComplete` — sin tocar nada más del archivo
- [ ] En `Login.tsx`: agregar un `useEffect` que llame `GET /api/system/status` al montar y guarde `initialized: boolean` en estado local; si `false`, renderizar el callout/banner antes del formulario
- [ ] El callout puede usar clases Tailwind existentes en el proyecto (mismo estilo que otros banners de advertencia en el dashboard)

**Relevant Context**
- `frontend/src/App.tsx` lines 103-117: bloque a eliminar
- `frontend/src/App.tsx` line 15: import `useSystemStatus` a eliminar
- `frontend/src/components/Login.tsx`: añadir lógica de status check y callout
- `frontend/src/hooks/useSystemStatus.ts`: eliminar

**Status:** [ ] pending

---

### Sub-Task 4 — Eliminar endpoints de setup del backend y binarios legacy

**Intent**
Eliminar `POST /api/system/setup`, `POST /api/system/setup/migration/preview`, todo el Migration Studio del backend, y los binarios separados `cmd/reset-password` y `cmd/clean-admin` que ahora están reemplazados por `admin reset` y `admin delete-all`. Mantener solo `GET /api/system/status`.

**Expected Outcomes**
- `internal/api/system.go`: solo queda `GetSystemStatus`. Todo lo demás eliminado.
- `internal/api/setup_migration.go` eliminado junto con sus 3 archivos de test.
- `cmd/reset-password/` eliminado.
- `cmd/clean-admin/` eliminado.
- `cmd/ozybase/main.go`: solo queda `GET /api/system/status` de las 3 rutas anteriores.
- `go build ./...` compila sin errores ni warnings.

**Todo List**
- [ ] En `internal/api/system.go`: eliminar `SetupSystem`, `PreviewSetupMigration` y todos sus tipos locales (`setupRequest`, `setupSystemResponse`, `migrationPreviewResponse`, `setupAppliedAction`, etc.)
- [ ] Eliminar archivos: `internal/api/setup_migration.go`, `internal/api/setup_migration_test.go`, `internal/api/setup_migration_parser_test.go`, `internal/api/setup_migration_insert_batch_test.go`
- [ ] En `cmd/ozybase/main.go` (lines 662-664): eliminar las dos rutas POST de setup, dejar solo `apiGroup.GET("/system/status", h.GetSystemStatus)`
- [ ] Eliminar directorio `cmd/reset-password/`
- [ ] Eliminar directorio `cmd/clean-admin/`
- [ ] Verificar `internal/api/workspace_bootstrap_test.go` — si llama a `/api/system/setup` eliminarlo o adaptarlo
- [ ] Correr `go build ./...` y confirmar 0 errores

**Relevant Context**
- `internal/api/system.go`: 3 handlers actuales; solo `GetSystemStatus` sobrevive
- `cmd/ozybase/main.go` lines 662-664: registro de rutas
- `internal/api/setup_migration.go`: todo el Migration Studio backend — eliminar completo
- `cmd/reset-password/main.go` + `cmd/clean-admin/main.go`: reemplazados por T1

**Status:** [ ] pending

---

## Orden de Ejecución

```
Sub-Task 1 → Sub-Task 2 → Sub-Task 3 → Sub-Task 4
```

Empezar por el CLI (T1+T2) porque son cambios de Go puro independientes del frontend. Luego el frontend (T3) y finalmente limpiar el backend (T4). Esto permite probar el flujo completo antes de eliminar código.

## Archivos afectados (resumen)

| Archivo | Acción |
|---------|--------|
| `cmd/ozybase/main.go` | Modificar: agregar grupo `admin` en `handleCLI`, cambiar banner no-init |
| `internal/auth/setup.go` | Modificar: extraer `createAdminWithWorkspace` como función reutilizable |
| `internal/auth/admin_cli_test.go` | **Crear**: tests para `createAdminWithWorkspace`, `runAdminReset`, etc. |
| `internal/api/system.go` | Modificar: eliminar `SetupSystem` y `PreviewSetupMigration` |
| `internal/api/setup_migration.go` | **Eliminar** |
| `internal/api/setup_migration_test.go` | **Eliminar** |
| `internal/api/setup_migration_parser_test.go` | **Eliminar** |
| `internal/api/setup_migration_insert_batch_test.go` | **Eliminar** |
| `cmd/reset-password/` | **Eliminar** (reemplazado por `admin reset`) |
| `cmd/clean-admin/` | **Eliminar** (reemplazado por `admin delete-all`) |
| `frontend/src/components/SetupWizard.tsx` | **Eliminar** |
| `frontend/src/hooks/useSystemStatus.ts` | **Eliminar** |
| `frontend/src/App.tsx` | Modificar: eliminar bloque wizard y estados relacionados |
| `frontend/src/components/Login.tsx` | Modificar: agregar callout de sistema no-inicializado |
