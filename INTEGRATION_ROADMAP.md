# 🗺️ OzyBase-Core: Plan de Integración Unificado

> **Documento Maestro de Implementación por Fases**  
> Última actualización: 25 de Enero, 2026  
> Versión: 1.0

---

## 📋 Índice

1. [Resumen Ejecutivo](#-resumen-ejecutivo)
2. [Fase 0: Fundación y Preparación](#-fase-0-fundación-y-preparación)
3. [Fase 1: Seguridad y Hardening](#-fase-1-seguridad-y-hardening)
4. [Fase 2: SDK del Cliente JavaScript/TypeScript](#-fase-2-sdk-del-cliente-javascripttypescript)
5. [Fase 3: Generación de Tipos (Type Generation)](#-fase-3-generación-de-tipos-type-generation)
6. [Fase 4: Optimización para Producción Linux](#-fase-4-optimización-para-producción-linux)
7. [Fase 5: Documentación y Testing](#-fase-5-documentación-y-testing)
8. [Cronograma General](#-cronograma-general)
9. [Métricas de Éxito](#-métricas-de-éxito)

---

## 📌 Resumen Ejecutivo

OzyBase-Core es un Backend-as-a-Service (BaaS) de alto rendimiento escrito en Go. Este documento consolida todas las integraciones planificadas para elevar la Developer Experience (DX) al nivel de Supabase/PocketBase.

### Tecnologías Base
| Componente | Tecnología |
|------------|------------|
| Lenguaje | Go (Golang) |
| Base de Datos | PostgreSQL |
| Framework Web | Echo |
| Autenticación | JWT (HS256) |
| Eventos en Tiempo Real | SSE + Postgres NOTIFY |

### Funcionalidades Actuales ✅
- [x] Colecciones dinámicas via API
- [x] Sistema de autenticación JWT
- [x] ACL granular (Public/Auth/Admin)
- [x] Subscripciones en tiempo real (SSE)
- [x] Almacenamiento local de archivos
- [x] Validación de contraseñas fuertes (mín. 8 caracteres)
- [x] Validación de formato de email (RFC 5322)

---

## 🏗️ Fase 0: Fundación y Preparación

> **Duración Estimada:** 1 semana  
> **Prioridad:** 🔴 Crítica

### Objetivos
Establecer la infraestructura base necesaria para las siguientes fases.

### Tareas

#### 0.1 Configuración del Entorno de Desarrollo
```bash
# Paso 1: Clonar el repositorio
git clone <repo-url>
cd OzyBase-Core

# Paso 2: Configurar variables de entorno
cp .env.example .env
# Editar .env con credenciales PostgreSQL

# Paso 3: Verificar compilación
go build ./cmd/OzyBase
./OzyBase
```

#### 0.2 Estructura de Carpetas para Integraciones
```
OzyBase-Core/
├── cmd/
│   └── OzyBase/          # Binario principal
├── internal/
│   ├── api/               # Controladores API
│   ├── meta/              # Operaciones Meta-Schema
│   ├── typegen/           # ← NUEVO: Generador de tipos
│   └── realtime/          # Sistema SSE
├── sdk/                   # ← NUEVO: SDK JavaScript
│   └── js/
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── deploy/                # ← NUEVO: Scripts de despliegue
│   ├── systemd/
│   └── nginx/
└── docs/                  # Documentación
```

#### 0.3 Requisitos Previos
| Requisito | Versión Mínima | Propósito |
|-----------|----------------|-----------|
| Go | 1.21+ | Compilación del servidor |
| PostgreSQL | 14+ | Base de datos principal |
| Node.js | 18+ | Desarrollo del SDK |
| pnpm/npm | 8+ | Gestión de paquetes SDK |

#### 0.4 Definir Versionado Semántico
```bash
# Formato de versión
MAJOR.MINOR.PATCH

# Ejemplo
v1.0.0 - Release inicial
v1.1.0 - Nueva funcionalidad (SDK)
v1.1.1 - Corrección de bugs
```

### Entregables
- [ ] Repositorio configurado con estructura de carpetas
- [ ] Variables de entorno documentadas
- [ ] CI/CD básico (GitHub Actions)
- [ ] README actualizado

---

## 🛡️ Fase 1: Seguridad y Hardening

> **Duración Estimada:** 2 semanas  
> **Prioridad:** 🔴 Crítica  
> **Dependencias:** Fase 0 completada

### Objetivos
Reforzar la seguridad del sistema de autenticación y preparar el binario para producción.

### Tareas

#### 1.1 Validaciones de Seguridad (Ya Implementadas ✅)

Las siguientes validaciones ya están en `internal/api/auth.go`:

```go
// Validación de Email (RFC 5322)
import "net/mail"
if _, err := mail.ParseAddress(email); err != nil {
    return c.JSON(400, map[string]string{"error": "Formato de email inválido"})
}

// Longitud mínima de contraseña
if len(password) < 8 {
    return c.JSON(400, map[string]string{"error": "La contraseña debe tener al menos 8 caracteres"})
}
```

#### 1.2 Mejoras Adicionales de Seguridad

##### 1.2.1 Rate Limiting
```go
// Paso 1: Instalar middleware
go get github.com/labstack/echo/v4/middleware

// Paso 2: Implementar en main.go
import "github.com/labstack/echo/v4/middleware"

e.Use(middleware.RateLimiter(middleware.NewRateLimiterMemoryStore(20)))
```

##### 1.2.2 Política de Contraseñas Complejas
```go
// internal/api/validation.go
package api

import (
    "regexp"
    "errors"
)

func ValidatePasswordComplexity(password string) error {
    if len(password) < 8 {
        return errors.New("mínimo 8 caracteres")
    }
    
    hasUpper := regexp.MustCompile(`[A-Z]`).MatchString(password)
    hasLower := regexp.MustCompile(`[a-z]`).MatchString(password)
    hasNumber := regexp.MustCompile(`[0-9]`).MatchString(password)
    hasSpecial := regexp.MustCompile(`[!@#$%^&*]`).MatchString(password)
    
    if !hasUpper || !hasLower || !hasNumber || !hasSpecial {
        return errors.New("debe contener mayúscula, minúscula, número y carácter especial")
    }
    
    return nil
}
```

##### 1.2.3 Protección contra Timing Attacks
```go
// Usar comparación de tiempo constante para tokens
import "crypto/subtle"

if subtle.ConstantTimeCompare([]byte(providedToken), []byte(storedToken)) != 1 {
    return errors.New("token inválido")
}
```

##### 1.2.4 Headers de Seguridad HTTP
```go
// middleware/security.go
func SecurityHeaders(next echo.HandlerFunc) echo.HandlerFunc {
    return func(c echo.Context) error {
        c.Response().Header().Set("X-Content-Type-Options", "nosniff")
        c.Response().Header().Set("X-Frame-Options", "DENY")
        c.Response().Header().Set("X-XSS-Protection", "1; mode=block")
        c.Response().Header().Set("Content-Security-Policy", "default-src 'self'")
        c.Response().Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return next(c)
    }
}
```

#### 1.3 Compilación Segura del Binario
```bash
# Build optimizado y sin símbolos de debug
go build -ldflags="-s -w" -o OzyBase ./cmd/OzyBase

# Verificar tamaño reducido
ls -lh OzyBase
```

#### 1.4 Pruebas de Seguridad
```bash
# Ejecutar suite de tests
go test ./internal/api -v

# Tests específicos de autenticación
go test ./internal/api -run TestSignup -v
```

### Verificación
| Test | Resultado Esperado |
|------|-------------------|
| Email inválido | 400 Bad Request |
| Contraseña < 8 chars | 400 Bad Request |
| Contraseña sin mayúscula | 400 Bad Request |
| Rate limit excedido | 429 Too Many Requests |

### Entregables
- [ ] Rate limiting implementado
- [ ] Política de contraseñas complejas
- [ ] Headers de seguridad HTTP
- [ ] Suite de tests de seguridad
- [ ] Documentación de seguridad actualizada

---

## 📦 Fase 2: SDK del Cliente JavaScript/TypeScript

> **Duración Estimada:** 3 semanas  
> **Prioridad:** 🟡 Alta  
> **Dependencias:** Fase 1 completada

### Objetivos
Crear una librería npm `@OzyBase/js-sdk` para una integración elegante con aplicaciones frontend.

### Estructura del SDK
```
sdk/js/
├── src/
│   ├── index.ts           # Punto de entrada
│   ├── client.ts          # Cliente principal
│   ├── auth.ts            # Módulo de autenticación
│   ├── collection.ts      # Operaciones CRUD
│   ├── realtime.ts        # Subscripciones SSE
│   ├── storage.ts         # Gestión de archivos
│   └── types.ts           # Tipos TypeScript
├── tests/
│   └── client.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

### Tareas

#### 2.1 Inicializar Proyecto SDK
```bash
# Paso 1: Crear directorio
mkdir -p sdk/js && cd sdk/js

# Paso 2: Inicializar npm
npm init -y

# Paso 3: Instalar dependencias de desarrollo
npm install -D typescript tsup vitest @types/node
```

#### 2.2 Configuración TypeScript
```json
// sdk/js/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### 2.3 Configuración de Package.json
```json
// sdk/js/package.json
{
  "name": "@OzyBase/js-sdk",
  "version": "0.1.0",
  "description": "JavaScript SDK for OzyBase BaaS",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts",
    "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
    "test": "vitest",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["OzyBase", "baas", "backend", "sdk"],
  "license": "MIT"
}
```

#### 2.4 Implementación del Cliente Principal
```typescript
// sdk/js/src/client.ts
import { AuthModule } from './auth';
import { CollectionModule } from './collection';
import { RealtimeModule } from './realtime';
import { StorageModule } from './storage';

export interface OzyBaseConfig {
  baseUrl: string;
  headers?: Record<string, string>;
}

export class OzyBase {
  private _baseUrl: string;
  private _token: string | null = null;
  
  public auth: AuthModule;
  public storage: StorageModule;
  private _realtime: RealtimeModule;
  
  constructor(baseUrl: string) {
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this.auth = new AuthModule(this);
    this.storage = new StorageModule(this);
    this._realtime = new RealtimeModule(this);
  }
  
  get baseUrl(): string {
    return this._baseUrl;
  }
  
  get token(): string | null {
    return this._token;
  }
  
  setToken(token: string | null): void {
    this._token = token;
  }
  
  collection<T = any>(name: string): CollectionModule<T> {
    return new CollectionModule<T>(this, name);
  }
  
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    };
    
    if (this._token) {
      headers['Authorization'] = `Bearer ${this._token}`;
    }
    
    const response = await fetch(`${this._baseUrl}${endpoint}`, {
      ...options,
      headers,
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new OzyBaseError(response.status, error.message || 'Request failed');
    }
    
    return response.json();
  }
}

export class OzyBaseError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'OzyBaseError';
  }
}

export default OzyBase;
```

#### 2.5 Módulo de Autenticación
```typescript
// sdk/js/src/auth.ts
import type { OzyBase } from './client';

export interface AuthUser {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export class AuthModule {
  constructor(private client: OzyBase) {}
  
  async signup(email: string, password: string): Promise<AuthResponse> {
    const response = await this.client.request<AuthResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    
    this.client.setToken(response.token);
    return response;
  }
  
  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await this.client.request<AuthResponse>('/api/auth/login', {
      method: 'POST', 
      body: JSON.stringify({ email, password }),
    });
    
    this.client.setToken(response.token);
    return response;
  }
  
  logout(): void {
    this.client.setToken(null);
  }
  
  isLoggedIn(): boolean {
    return this.client.token !== null;
  }
}
```

#### 2.6 Módulo de Colecciones (CRUD)
```typescript
// sdk/js/src/collection.ts
import type { OzyBase } from './client';

export interface ListOptions {
  page?: number;
  perPage?: number;
  filter?: string;
  sort?: string;
}

export interface ListResult<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export interface BaseRecord {
  id: string;
  created_at: string;
  updated_at: string;
}

export class CollectionModule<T = any> {
  constructor(
    private client: OzyBase,
    private name: string
  ) {}
  
  async getList(options: ListOptions = {}): Promise<ListResult<T & BaseRecord>> {
    const params = new URLSearchParams();
    if (options.page) params.set('page', String(options.page));
    if (options.perPage) params.set('perPage', String(options.perPage));
    if (options.filter) params.set('filter', options.filter);
    if (options.sort) params.set('sort', options.sort);
    
    const query = params.toString();
    const endpoint = `/api/collections/${this.name}/records${query ? `?${query}` : ''}`;
    
    return this.client.request<ListResult<T & BaseRecord>>(endpoint);
  }
  
  async getOne(id: string): Promise<T & BaseRecord> {
    return this.client.request<T & BaseRecord>(
      `/api/collections/${this.name}/records/${id}`
    );
  }
  
  async create(data: Partial<T>): Promise<T & BaseRecord> {
    return this.client.request<T & BaseRecord>(
      `/api/collections/${this.name}/records`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }
  
  async update(id: string, data: Partial<T>): Promise<T & BaseRecord> {
    return this.client.request<T & BaseRecord>(
      `/api/collections/${this.name}/records/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    );
  }
  
  async delete(id: string): Promise<void> {
    await this.client.request<void>(
      `/api/collections/${this.name}/records/${id}`,
      { method: 'DELETE' }
    );
  }
  
  subscribe(
    recordId: string | '*',
    callback: (event: RealtimeEvent<T>) => void
  ): () => void {
    return this.client['_realtime'].subscribe(this.name, recordId, callback);
  }
}

export interface RealtimeEvent<T> {
  action: 'create' | 'update' | 'delete';
  record: T & BaseRecord;
}
```

#### 2.7 Módulo de Realtime (SSE)
```typescript
// sdk/js/src/realtime.ts
import type { OzyBase } from './client';
import type { RealtimeEvent, BaseRecord } from './collection';

type Callback<T> = (event: RealtimeEvent<T>) => void;

export class RealtimeModule {
  private eventSource: EventSource | null = null;
  private subscriptions: Map<string, Set<Callback<any>>> = new Map();
  
  constructor(private client: OzyBase) {}
  
  subscribe<T>(
    collection: string,
    recordId: string | '*',
    callback: Callback<T>
  ): () => void {
    this.ensureConnection();
    
    const key = `${collection}:${recordId}`;
    
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }
    
    this.subscriptions.get(key)!.add(callback);
    
    // Retornar función de unsubscribe
    return () => {
      const callbacks = this.subscriptions.get(key);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscriptions.delete(key);
        }
      }
      
      if (this.subscriptions.size === 0) {
        this.disconnect();
      }
    };
  }
  
  private ensureConnection(): void {
    if (this.eventSource) return;
    
    const url = new URL('/api/realtime', this.client.baseUrl);
    if (this.client.token) {
      url.searchParams.set('token', this.client.token);
    }
    
    this.eventSource = new EventSource(url.toString());
    
    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const { collection, action, record } = data;
        
        // Notificar a subscriptores específicos
        const specificKey = `${collection}:${record.id}`;
        this.notifyCallbacks(specificKey, { action, record });
        
        // Notificar a subscriptores globales de la colección
        const globalKey = `${collection}:*`;
        this.notifyCallbacks(globalKey, { action, record });
        
      } catch (e) {
        console.error('OzyBase Realtime: Error parsing event', e);
      }
    };
    
    this.eventSource.onerror = () => {
      console.error('OzyBase Realtime: Connection error, reconnecting...');
      this.disconnect();
      setTimeout(() => this.ensureConnection(), 3000);
    };
  }
  
  private notifyCallbacks<T>(key: string, event: RealtimeEvent<T>): void {
    const callbacks = this.subscriptions.get(key);
    if (callbacks) {
      callbacks.forEach(cb => cb(event));
    }
  }
  
  private disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
```

#### 2.8 Punto de Entrada del SDK
```typescript
// sdk/js/src/index.ts
export { OzyBase, OzyBaseError } from './client';
export type { OzyBaseConfig } from './client';
export type { AuthUser, AuthResponse } from './auth';
export type { ListOptions, ListResult, BaseRecord, RealtimeEvent } from './collection';

export default OzyBase;
```

#### 2.9 Ejemplo de Uso Final
```javascript
import OzyBase from '@OzyBase/js-sdk';

// Inicializar cliente
const client = new OzyBase('https://mi-api.com');

// Autenticación
await client.auth.login('user@email.com', 'password123');

// CRUD de colecciones
const laptops = await client.collection('productos').getList({
  page: 1,
  perPage: 20,
  filter: 'precio > 1000',
  sort: '-created_at'
});

// Crear registro
const nuevo = await client.collection('productos').create({
  nombre: 'MacBook Pro',
  precio: 2500
});

// Subscripción en tiempo real
const unsubscribe = client.collection('productos').subscribe('*', (event) => {
  console.log('Cambio detectado:', event.action, event.record);
});

// Cancelar subscripción
unsubscribe();
```

### Entregables
- [ ] SDK TypeScript completo
- [ ] Módulos: auth, collection, realtime, storage
- [ ] Tests unitarios con Vitest
- [ ] Documentación de API
- [ ] Publicación en npm (opcional)

---

## 💎 Fase 3: Generación de Tipos (Type Generation)

> **Duración Estimada:** 2 semanas  
> **Prioridad:** 🟡 Alta  
> **Dependencias:** Fase 2 completada

### Objetivos
Crear un subcomando CLI que genere interfaces TypeScript basadas en el schema de la base de datos.

### Tareas

#### 3.1 Crear Estructura del Generador
```
internal/typegen/
├── generator.go       # Lógica principal
├── templates.go       # Templates de código
└── types.go           # Mapeo de tipos
```

#### 3.2 Implementación del Generador
```go
// internal/typegen/generator.go
package typegen

import (
    "database/sql"
    "fmt"
    "os"
    "strings"
    "text/template"
    "time"
)

type Field struct {
    Name     string
    Type     string
    TSType   string
    Required bool
}

type Collection struct {
    Name   string
    Fields []Field
}

type TypeGenerator struct {
    db *sql.DB
}

func NewTypeGenerator(db *sql.DB) *TypeGenerator {
    return &TypeGenerator{db: db}
}

func (g *TypeGenerator) Generate(outputPath string) error {
    collections, err := g.fetchCollections()
    if err != nil {
        return fmt.Errorf("error fetching collections: %w", err)
    }
    
    return g.writeTypesFile(outputPath, collections)
}

func (g *TypeGenerator) fetchCollections() ([]Collection, error) {
    rows, err := g.db.Query(`
        SELECT name, fields FROM _v_collections
    `)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    
    var collections []Collection
    for rows.Next() {
        var name string
        var fieldsJSON []byte
        
        if err := rows.Scan(&name, &fieldsJSON); err != nil {
            return nil, err
        }
        
        fields := parseFields(fieldsJSON)
        collections = append(collections, Collection{
            Name:   name,
            Fields: fields,
        })
    }
    
    return collections, nil
}

func (g *TypeGenerator) writeTypesFile(path string, collections []Collection) error {
    tmpl := template.Must(template.New("types").Parse(typesTemplate))
    
    file, err := os.Create(path)
    if err != nil {
        return err
    }
    defer file.Close()
    
    return tmpl.Execute(file, map[string]any{
        "GeneratedAt": time.Now().Format(time.RFC3339),
        "Collections": collections,
    })
}
```

#### 3.3 Mapeo de Tipos OzyBase → TypeScript
```go
// internal/typegen/types.go
package typegen

var typeMapping = map[string]string{
    "text":     "string",
    "number":   "number",
    "bool":     "boolean",
    "json":     "Record<string, any>",
    "date":     "string",      // ISO 8601
    "datetime": "string",      // ISO 8601
    "file":     "string",      // URL del archivo
    "relation": "string",      // ID de la relación
    "select":   "string",
    "email":    "string",
    "url":      "string",
}

func MapType(OzyBaseType string) string {
    if ts, ok := typeMapping[OzyBaseType]; ok {
        return ts
    }
    return "any"
}
```

#### 3.4 Template de Generación
```go
// internal/typegen/templates.go
package typegen

const typesTemplate = `/**
 * Auto-generated by OzyBase CLI
 * Generated at: {{.GeneratedAt}}
 * 
 * DO NOT EDIT MANUALLY
 * Run 'OzyBase gen-types' to regenerate
 */

/** Base record type with common fields */
export interface BaseRecord {
  id: string;
  created_at: string;
  updated_at: string;
}

{{range .Collections}}
/** Collection: {{.Name}} */
export interface {{.Name | ToPascalCase}} extends BaseRecord {
{{range .Fields}}  {{.Name}}: {{.TSType}}{{if not .Required}} | null{{end}};
{{end}}}

{{end}}

/** Database schema with all collections */
export interface OzyBaseSchema {
{{range .Collections}}  {{.Name}}: {{.Name | ToPascalCase}};
{{end}}}

/** Type-safe collection names */
export type CollectionName = keyof OzyBaseSchema;

export default OzyBaseSchema;
`
```

#### 3.5 Comando CLI
```go
// cmd/OzyBase/main.go (agregar subcomando)
package main

import (
    "flag"
    "fmt"
    "os"
    
    "OzyBase/internal/typegen"
)

func main() {
    if len(os.Args) > 1 && os.Args[1] == "gen-types" {
        genTypesCmd := flag.NewFlagSet("gen-types", flag.ExitOnError)
        output := genTypesCmd.String("out", "./src/types/OzyBase.d.ts", "Output path for types")
        
        genTypesCmd.Parse(os.Args[2:])
        
        if err := runGenTypes(*output); err != nil {
            fmt.Fprintf(os.Stderr, "Error: %v\n", err)
            os.Exit(1)
        }
        
        fmt.Printf("✅ Types generated at %s\n", *output)
        return
    }
    
    // ... resto del código del servidor
}

func runGenTypes(outputPath string) error {
    db := connectDB()
    defer db.Close()
    
    gen := typegen.NewTypeGenerator(db)
    return gen.Generate(outputPath)
}
```

#### 3.6 Uso del Generador
```bash
# Generar tipos en ubicación por defecto
./OzyBase gen-types

# Generar en ubicación personalizada
./OzyBase gen-types --out ./frontend/src/types/db.d.ts
```

#### 3.7 Ejemplo de Salida Generada
```typescript
// ./src/types/OzyBase.d.ts (archivo generado)

/**
 * Auto-generated by OzyBase CLI
 * Generated at: 2026-01-25T10:00:00Z
 * 
 * DO NOT EDIT MANUALLY
 */

export interface BaseRecord {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface Productos extends BaseRecord {
  nombre: string;
  descripcion: string | null;
  precio: number;
  activo: boolean;
  categoria_id: string;
}

export interface Categorias extends BaseRecord {
  nombre: string;
  icono: string | null;
}

export interface OzyBaseSchema {
  productos: Productos;
  categorias: Categorias;
}

export type CollectionName = keyof OzyBaseSchema;

export default OzyBaseSchema;
```

#### 3.8 Integración con SDK (Uso Tipado)
```typescript
import OzyBase from '@OzyBase/js-sdk';
import type { Productos, Categorias } from './types/OzyBase';

const client = new OzyBase('https://mi-api.com');

// ✅ Autocompletado completo
const productos = await client.collection<Productos>('productos').getList();
productos.items.forEach(p => {
  console.log(p.nombre, p.precio); // TypeScript conoce los campos
});
```

### Entregables
- [ ] Generador de tipos implementado en Go
- [ ] Subcomando CLI `gen-types`
- [ ] Mapeo completo de tipos
- [ ] Documentación de uso
- [ ] Tests del generador

---

## 🐧 Fase 4: Optimización para Producción Linux

> **Duración Estimada:** 2 semanas  
> **Prioridad:** 🟡 Alta  
> **Dependencias:** Fase 1 completada

### Objetivos
Preparar OzyBase para despliegue en servidores Linux con alto rendimiento y seguridad.

### Tareas

#### 4.1 Creación de Usuario Dedicado
```bash
# Paso 1: Crear usuario sin shell (seguridad)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin OzyBase

# Paso 2: Crear directorio de trabajo
sudo mkdir -p /opt/OzyBase
sudo chown OzyBase:OzyBase /opt/OzyBase
```

#### 4.2 Servicio Systemd
```ini
# /etc/systemd/system/OzyBase.service
[Unit]
Description=OzyBase BaaS - Backend as a Service
Documentation=https://github.com/Xangel0s/OzyBase
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=OzyBase
Group=OzyBase

# Binario y directorio
ExecStart=/opt/OzyBase/OzyBase
WorkingDirectory=/opt/OzyBase

# Reinicio automático
Restart=always
RestartSec=5

# Variables de entorno
EnvironmentFile=/opt/OzyBase/.env

# Límites de recursos
LimitNOFILE=65536
LimitNPROC=65536

# Seguridad adicional
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/OzyBase/data

# Timeouts
TimeoutStartSec=30
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

#### 4.3 Comandos de Gestión del Servicio
```bash
# Recargar configuración de systemd
sudo systemctl daemon-reload

# Habilitar inicio automático
sudo systemctl enable OzyBase

# Iniciar/Parar/Reiniciar
sudo systemctl start OzyBase
sudo systemctl stop OzyBase
sudo systemctl restart OzyBase

# Ver logs
sudo journalctl -u OzyBase -f

# Ver estado
sudo systemctl status OzyBase
```

#### 4.4 Configuración de Nginx (Reverse Proxy)
```nginx
# /etc/nginx/sites-available/OzyBase
upstream OzyBase_backend {
    server 127.0.0.1:8090;
    keepalive 32;
}

server {
    listen 80;
    server_name api.tudominio.com;
    
    # Redirección a HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.tudominio.com;
    
    # Certificados SSL (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/api.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.tudominio.com/privkey.pem;
    
    # Configuración SSL moderna
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    
    # Headers de seguridad
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Compresión
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript;
    
    # Proxy principal
    location / {
        proxy_pass http://OzyBase_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket/SSE support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
    
    # Endpoint de realtime (SSE)
    location /api/realtime {
        proxy_pass http://OzyBase_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
    }
}
```

#### 4.5 Habilitar Configuración de Nginx
```bash
# Crear enlace simbólico
sudo ln -s /etc/nginx/sites-available/OzyBase /etc/nginx/sites-enabled/

# Verificar configuración
sudo nginx -t

# Recargar nginx
sudo systemctl reload nginx
```

#### 4.6 Obtener Certificado SSL con Certbot
```bash
# Instalar Certbot
sudo apt install certbot python3-certbot-nginx

# Obtener certificado
sudo certbot --nginx -d api.tudominio.com

# Renovación automática (ya configurada por defecto)
sudo certbot renew --dry-run
```

#### 4.7 Optimización del Kernel (Sysctl)
```bash
# /etc/sysctl.d/99-OzyBase.conf

# Aumentar conexiones máximas
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096

# Archivos abiertos
fs.file-max = 100000

# Reutilización de conexiones TIME_WAIT
net.ipv4.tcp_tw_reuse = 1

# Buffer de red
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216

# Keepalive
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 60
net.ipv4.tcp_keepalive_probes = 3
```

#### 4.8 Aplicar Configuración del Kernel
```bash
sudo sysctl -p /etc/sysctl.d/99-OzyBase.conf
```

#### 4.9 Script de Despliegue Automatizado
```bash
#!/bin/bash
# deploy/install.sh

set -e

echo "🚀 OzyBase Installation Script"
echo "================================"

# Variables
OzyBase_VERSION=${1:-"latest"}
INSTALL_DIR="/opt/OzyBase"

# Crear usuario
echo "📦 Creating OzyBase user..."
sudo useradd --system --no-create-home --shell /usr/sbin/nologin OzyBase 2>/dev/null || true

# Crear directorio
echo "📁 Setting up directories..."
sudo mkdir -p $INSTALL_DIR/data
sudo chown -R OzyBase:OzyBase $INSTALL_DIR

# Descargar binario (ajustar URL)
echo "⬇️ Downloading OzyBase..."
# sudo wget -O $INSTALL_DIR/OzyBase https://releases.OzyBase.dev/$OzyBase_VERSION/OzyBase-linux-amd64
# sudo chmod +x $INSTALL_DIR/OzyBase

# Copiar archivo .env de ejemplo
echo "⚙️ Setting up environment..."
if [ ! -f "$INSTALL_DIR/.env" ]; then
    sudo cp $INSTALL_DIR/.env.example $INSTALL_DIR/.env
    echo "⚠️  Please edit $INSTALL_DIR/.env with your configuration"
fi

# Instalar servicio systemd
echo "🔧 Installing systemd service..."
sudo cp deploy/systemd/OzyBase.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable OzyBase

echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Edit $INSTALL_DIR/.env"
echo "  2. Run: sudo systemctl start OzyBase"
echo "  3. Check status: sudo systemctl status OzyBase"
```

### Entregables
- [ ] Servicio Systemd configurado
- [ ] Configuración de Nginx con SSL
- [ ] Optimización del kernel
- [ ] Script de instalación automatizado
- [ ] Documentación de despliegue

---

## 📚 Fase 5: Documentación y Testing

> **Duración Estimada:** 2 semanas  
> **Prioridad:** 🟢 Media  
> **Dependencias:** Fases 1-4 completadas

### Objetivos
Crear documentación completa y suite de tests para garantizar calidad.

### Tareas

#### 5.1 Estructura de Documentación
```
docs/
├── getting-started/
│   ├── installation.md
│   ├── quick-start.md
│   └── configuration.md
├── api/
│   ├── authentication.md
│   ├── collections.md
│   ├── records.md
│   ├── realtime.md
│   └── storage.md
├── sdk/
│   ├── installation.md
│   ├── client.md
│   ├── auth.md
│   ├── collections.md
│   └── realtime.md
├── deployment/
│   ├── linux.md
│   ├── docker.md
│   └── security.md
└── examples/
    ├── todo-app.md
    ├── chat-app.md
    └── e-commerce.md
```

#### 5.2 Suite de Tests
```bash
# Ejecutar todos los tests
go test ./... -v

# Tests con cobertura
go test ./... -cover -coverprofile=coverage.out

# Generar reporte HTML
go tool cover -html=coverage.out -o coverage.html

# Tests del SDK
cd sdk/js && npm test
```

#### 5.3 Tests de Integración
```go
// internal/api/integration_test.go
package api_test

import (
    "net/http/httptest"
    "testing"
)

func TestFullUserFlow(t *testing.T) {
    // 1. Signup
    // 2. Login
    // 3. Create collection
    // 4. CRUD operations
    // 5. Realtime subscription
    // 6. Cleanup
}
```

#### 5.4 Documentación del API (OpenAPI/Swagger)
```yaml
# docs/openapi.yaml
openapi: 3.0.3
info:
  title: OzyBase API
  version: 1.0.0
  description: Backend-as-a-Service API

paths:
  /api/auth/signup:
    post:
      summary: User registration
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AuthRequest'
      responses:
        '201':
          description: User created
        '400':
          description: Validation error

components:
  schemas:
    AuthRequest:
      type: object
      required:
        - email
        - password
      properties:
        email:
          type: string
          format: email
        password:
          type: string
          minLength: 8
```

### Entregables
- [ ] Documentación completa en Markdown
- [ ] Especificación OpenAPI
- [ ] Suite de tests con >80% cobertura
- [ ] Ejemplos de aplicaciones
- [ ] README actualizado

---

## 📅 Cronograma General

```
Semana 1-2:    ████████ Fase 0: Fundación ✅
Semana 2-4:    ████████████████ Fase 1: Seguridad ✅
Semana 4-7:    ████████████████████████ Fase 2: SDK ✅
Semana 7-9:    ████████████████ Fase 3: Type Gen ✅
Semana 9-11:   ████████████████ Fase 4: Producción ✅
Semana 11-13:  ████████████████ Fase 5: Docs/Tests
```

| Fase | Duración | Inicio | Fin |
|------|----------|--------|-----|
| Fase 0: Fundación | 1 semana | Semana 1 | Semana 1 |
| Fase 1: Seguridad | 2 semanas | Semana 2 | Semana 3 |
| Fase 2: SDK JS/TS | 3 semanas | Semana 4 | Semana 6 |
| Fase 3: Type Generation | 2 semanas | Semana 7 | Semana 8 |
| Fase 4: Producción Linux | 2 semanas | Semana 9 | Semana 10 |
| Fase 5: Docs/Testing | 2 semanas | Semana 11 | Semana 12 |

**Total Estimado:** 12 semanas (3 meses)

---

## 📊 Métricas de Éxito

### KPIs por Fase

| Fase | Métrica | Objetivo |
|------|---------|----------|
| Fase 1 | Tests de seguridad pasando | 100% |
| Fase 2 | Tamaño del bundle SDK | < 10KB gzip |
| Fase 3 | Tiempo de generación de tipos | < 2 segundos |
| Fase 4 | Conexiones SSE simultáneas | > 10,000 |
| Fase 5 | Cobertura de tests | > 80% |

### Criterios de Aceptación Globales

- ✅ Todos los tests pasan en CI/CD
- ✅ Documentación completa y actualizada
- ✅ Sin vulnerabilidades críticas en auditoría
- ✅ SDK publicado en npm (opcional)
- ✅ Despliegue exitoso en servidor de pruebas

### 🏆 Ventaja Competitiva: Comparativa de Recursos

Esta es la **MAYOR VENTAJA** de OzyBase: el enfoque "Single Binary" de Go.

| Métrica | Supabase (Docker) | OzyBase-Core | Diferencia |
|---------|-------------------|---------------|------------|
| **RAM en reposo** | ~1.5 GB | < 30 MB | **50x menos** |
| **Tamaño del binario** | ~2 GB (imágenes) | < 20 MB | **100x menos** |
| **Tiempo de arranque** | ~30-60 segundos | < 1 segundo | **60x más rápido** |
| **Costo VPS mínimo** | $20-40/mes | $5/mes | **4-8x más barato** |
| **Dependencias externas** | Docker, Redis, Kong, GoTrue... | Solo PostgreSQL | **Simplicidad** |

```
┌─────────────────────────────────────────────────────────────┐
│                    USO DE RAM EN REPOSO                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Supabase:  ████████████████████████████████████████  1.5GB │
│                                                              │
│  OzyBase:  █  30MB                                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

> **💡 Mensaje para el README:**  
> *"OzyBase corre en un VPS de $5 mientras que Supabase necesita uno de $40.  
> Mismas funcionalidades, 1/8 del costo."*

---

## 🔗 Referencias

- **Repositorio**: OzyBase-Core
- **Documentos Relacionados**:
  - [FUTURE_INTEGRATIONS.md](./FUTURE_INTEGRATIONS.md)
  - [SECURITY_HARDENING.md](./SECURITY_HARDENING.md)
  - [README.md](./README.md)

---

*Documento creado por OzyBase Team - Enero 2026*  
**OzyBase: Potencia en un solo binario.** 🛡️🚀

