# OzyBase — Agentic Backend-as-a-Service (BaaS)

<p align="center">
  <img src="docs/banner.jpg" alt="OzyBase Banner" width="100%" />
</p>

<p align="center">
  <a href="#-desafío-ibm-skillsbuild-julio"><img src="https://img.shields.io/badge/IBM_SkillsBuild-Julio_2026-blue.svg?style=for-the-badge&logo=ibm" alt="IBM SkillsBuild"></a>
  <a href="#-enfoque-y-arquitectura-de-la-ia"><img src="https://img.shields.io/badge/AI-MCP_Protocol-purple.svg?style=for-the-badge" alt="MCP Protocol"></a>
  <a href="https://golang.org"><img src="https://img.shields.io/badge/Go-1.25-00ADD8.svg?style=for-the-badge&logo=go" alt="Go"></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-19-61DAFB.svg?style=for-the-badge&logo=react" alt="React"></a>
  <a href="https://www.postgresql.org"><img src="https://img.shields.io/badge/PostgreSQL-15-4169E1.svg?style=for-the-badge&logo=postgresql" alt="PostgreSQL"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" alt="License"></a>
</p>

**OzyBase** es la primera plataforma **Backend-as-a-Service (BaaS) Agéntica de código abierto**, diseñada para ejecutarse como un binario único en Go con panel de control React embebido y motor PostgreSQL. 

Con un consumo ultrabajo de memoria (**~56 MB RAM total**, un 4% de Supabase), OzyBase integra de forma nativa el **Model Context Protocol (MCP)** para permitir que agentes de IA autónomos (como Claude, Cursor, Windsurf o IBM Bob) administren la infraestructura en tiempo real sin requerir intervención humana.

---

## 🏆 Desafío IBM SkillsBuild (Julio 2026)

### 📌 Tema del Desafío Seleccionado
> **Innovación en Inteligencia Artificial y Agentes Autónomos para Infraestructura Cloud Resiliente**

---

### 1. Planteamiento del Problema
Las plataformas de desarrollo modernas Backend-as-a-Service (como Supabase o Firebase) enfrentan tres barreras críticas en entornos de producción e integración con IA:

1. **Alto Consumo de Recursos (Heavy Resource Footprint)**: Desplegar contenedores tradicionales requiere más de 1.2 GB de RAM solo para mantenerse en reposo, encareciendo los costos en servidores VPS y Edge.
2. **Dependencia de Intervención Humana (DevOps Bottleneck)**: La creación de tablas, migración de esquemas, configuración de políticas de seguridad Row Level Security (RLS), respaldo de bases de datos y rotación de claves API requieren comandos manuales continuos.
3. **Falta de Protocolos Agénticos Nativos**: Los modelos de lenguaje (LLMs) carecen de un canal estructurado y seguro para interactuar con el backend como administradores sin arriesgar la integridad de la base de datos o sufrir bloqueos por restricciones de unicidad y claves foráneas.

---

### 2. Descripción de la Solución
**OzyBase** resuelve este problema combinando la potencia de un backend en Go de ultra-alto rendimiento con una **capa de control agéntico nativo mediante MCP**:

* **Servidor Unificado de ~56 MB de RAM**: Incluye API REST, WebSocket Realtime, Motor de Funciones Edge en JavaScript, Storage compatible con S3 y autenticación JWT en un binario ligero.
* **Agencia Autónomo Vía MCP (Model Context Protocol)**: Expone un endpoint JSON-RPC 2.0 en `/api/project/mcp` que habilita un catálogo autodescubrible de herramientas para que cualquier agente de IA pueda:
  - 🛠️ Ejecutar consultas SQL y DDL de forma segura (`sql.query`).
  - 📜 Crear y aplicar migraciones como código (`migration.create`).
  - 🔒 Configurar políticas de seguridad RLS en vivo (`rls.configure`).
  - 🔑 Rotar claves esenciales de API con auto-sanación (`keys.rotate`).
  - 💾 Generar snapshots/respaldos automáticos de la base de datos (`backup.create`).
  - 📖 Consultar guías y arquitectura del sistema en tiempo real (`system.guide`).

---

### 3. Enfoque y Arquitectura de la IA

```
 ┌─────────────────────────────────────────────────────────────┐
 │                    Agente de IA Autónomo                     │
 │          (IBM Bob / Claude / Cursor / LLM Client)           │
 └──────────────────────────────┬──────────────────────────────┘
                                │ JSON-RPC 2.0 (MCP Protocol)
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                      OZYBASE ENGINE                         │
 │                                                             │
 │   ┌───────────────────────┐     ┌───────────────────────┐   │
 │   │   MCP Handler & Tools │     │ REST & Auth Middleware│   │
 │   │   (internal/api/mcp)  │     │ (internal/api/middleware) │
 │   └───────────┬───────────┘     └───────────┬───────────┘   │
 │               │                             │               │
 │               ▼                             ▼               │
 │   ┌─────────────────────────────────────────────────────┐   │
 │   │       Self-Healing Essential Keys Engine           │   │
 │   │         (internal/api/essential_keys.go)            │   │
 │   └─────────────────────────┬───────────────────────────┘   │
 └─────────────────────────────┼───────────────────────────────┘
                               │ pgx Pool / Transactions
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                      POSTGRESQL 15                          │
 │    Tables, RLS Policies, Vector Search (pgvector), Triggers   │
 └─────────────────────────────────────────────────────────────┘
```

#### Pilares de la Arquitectura de IA:
1. **Model Context Protocol (MCP)**: Protocolo abierto estándar en `/api/project/mcp` que permite el descubrimiento dinámico de herramientas y autodocumentación (`system.guide`).
2. **Auto-Sanación Idempotente (Agentic Self-Healing)**:
   - Resuelve automáticamente conflictos de unicidad PostgreSQL (`SQLSTATE 23505`) y claves foráneas (`SQLSTATE 23503`) durante operaciones autónomas del agente.
   - Implementa un flujo atómico de tres pasos para rotación de credenciales: **Desactivación previa -> Inserción -> Vinculación de rotación**.
3. **Aislamiento por Dominio (`managed_kind`)**:
   - Diferencia estrictamente llaves infraestructurales (`essential`: `anon` / `service_role`) de llaves personalizadas del desarrollador (`custom`). Los reinicios y rotaciones del servidor jamás revocan llaves personalizadas o tokens MCP del usuario.
4. **Búsqueda Vectorial Integrada**: Soporte nativo para embeddings y búsqueda semántica con `pgvector`.

---

### 4. Cómo se utilizaba IBM Bob

**IBM Bob** funcionó como el asistente avanzado de IA y copiloto de desarrollo (*Pair Programmer*) durante todo el ciclo de vida del proyecto:

1. **Diseño de la Arquitectura de Seguridad Agéntica**: Co-diseño del motor de auto-sanación de claves esenciales en `internal/api/essential_keys.go`.
2. **Hardening de Transacciones PostgreSQL**: Identificación y resolución defensiva de violaciones de restricciones `idx_api_keys_active_essential_role` y `rotated_to_key_id_fkey`.
3. **Autodocumentación e Integración de MCP Tools**: Creación del generador dinámico de guías del sistema (`system.guide`) para que el agente entienda el modelo de datos y permisos sin intervención humana.
4. **Pruebas de Resiliencia y Refactorización**: Diagnóstico y saneamiento de middlewares REST/RLS para garantizar que las respuestas HTTP sigan los estándares RFC y OWASP.

---

### 5. Contexto de Participación: IBM SkillsBuild (Julio)

Proyecto desarrollado y presentado para la edición de **Julio 2026** del programa **IBM SkillsBuild**, demostrando la aplicación práctica de arquitectura de software moderna en Go, seguridad cloud, integración de LLMs mediante MCP y mejores prácticas de DevOps.

---

## ⚡ Benchmarks de Rendimiento

Mediciones reales en entorno Docker (Workload de desarrollo):

| Servicio | Memoria RAM | Límite | PIDs |
|---|---|---|---|
| **OzyBase Core** | **~11 MB** | 256 MB | 14 |
| **PostgreSQL 15 (Alpine)** | **~35 MB** | 512 MB | 9 |
| **DB Backup Service** | **~10 MB** | — | 9 |
| **Total Stack Completo** | **~56 MB** | 768 MB | 32 |

> **Comparativa**: Mientras que un stack equivalente de Supabase requiere ~1.2 GB de RAM, OzyBase funciona en producción con solo **~56 MB (4% del consumo)**.

---

## 🛠️ Herramientas MCP Disponibles para Agentes de IA

| Herramienta MCP | Descripción | Parámetros |
|---|---|---|
| 💾 `backup.create` | Crea un snapshot/backup etiquetado de esquemas y datos. | `label` *(opcional)* |
| 🔑 `keys.rotate` | Rota llaves esenciales (`anon` o `service_role`) de forma segura. | `role` (`anon` o `service_role`) |
| 📜 `migration.create` | Crea y aplica migraciones SQL versionadas en `./migrations`. | `name`, `sql` |
| 🔒 `rls.configure` | Configura políticas de Row Level Security (RLS) en tablas. | `table`, `enabled`, `rule` |
| ⚡ `sql.query` | Ejecuta consultas SQL/DDL/DML arbitrarias. | `query` |
| 📋 `schema.list_tables` | Lista todas las tablas públicas con estado de RLS y Realtime. | N/A |
| 📡 `realtime.toggle` | Activa o desactiva eventos WebSocket Realtime por tabla. | `table`, `enabled` |
| 📁 `storage.create_bucket` | Crea buckets de almacenamiento público o privado. | `name`, `public` |
| ⚙️ `functions.deploy` | Despliega o actualiza funciones Edge en JavaScript/WASM. | `name`, `script`, `runtime` |
| 📖 `system.guide` | Obtiene la guía operativa y arquitectura del sistema para la IA. | N/A |
| 🏥 `system.health` | Retorna el estado de salud e métricas de infraestructura. | N/A |

---

## 🚀 Inicio Rápido (Quick Start)

### Requisitos Previos
* Git
* Docker & Docker Compose (o Go 1.25+)

### Despliegue en 1 Comando
```bash
# 1. Clonar el repositorio
git clone https://github.com/Xangel0s/OzyBase.git
cd OzyBase

# 2. Desplegar con Docker Compose
docker compose up -d

# 3. Abrir el Dashboard en el navegador
open http://localhost:8090
```

### Iniciar en Desarrollo Local
```bash
# Backend Go (Puerto 8090)
go run ./cmd/ozybase

# Frontend React (Puerto 5342)
cd frontend
npm install
npm run dev
```

---

## 🏗️ Stack Tecnológico

| Capa | Tecnología |
|---|---|
| **Backend Core** | Go 1.25, Echo Framework, pgx pool |
| **Protocolo Agéntico** | MCP (Model Context Protocol JSON-RPC 2.0) |
| **Dashboard UI** | React 19, Vite, Tailwind CSS, shadcn/ui |
| **Base de Datos** | PostgreSQL 15 + pgvector extension |
| **JS Engine (Edge)** | Goja (V8-like embedded engine) |
| **WASM Engine** | Wazero (Zero-dependency WASI engine) |

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT** — Código libre y abierto para ser utilizado, modificado y desplegado sin restricciones.
