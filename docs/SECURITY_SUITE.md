# 🛡️ OzyBase Security Suite - Guía Completa

## Descripción General

OzyBase incluye un **Sistema de Seguridad de Grado Empresarial** con múltiples capas de protección, monitoreo en tiempo real y alertas automáticas. Este documento proporciona una visión general de todas las características de seguridad implementadas.

---

## 🔐 Componentes del Sistema de Seguridad

### 1. **RBAC (Role-Based Access Control)**
Control de acceso granular basado en roles para cada operación de base de datos.

**Características:**
- ✅ Reglas independientes para `List`, `Create`, `Update`, `Delete`
- ✅ Roles predefinidos: `public`, `auth`, `admin`, `editor`, `manager`
- ✅ Validación en tiempo real en cada petición
- ✅ Interfaz visual para gestión de permisos

**Ubicación**: `Authentication > Permissions`

**Ejemplo de Configuración:**
```javascript
// Tabla "posts"
list_rule: "public"      // Cualquiera puede listar
create_rule: "auth"      // Solo usuarios autenticados pueden crear
update_rule: "admin"     // Solo admins pueden actualizar
delete_rule: "admin"     // Solo admins pueden eliminar
```

---

### 2. **Geo-Fencing (Geovallado)**
Restricción de acceso basada en la ubicación geográfica del cliente.

**Características:**
- ✅ Lista blanca de países permitidos
- ✅ Detección automática de IP geográfica (ip-api.com)
- ✅ Caché de geolocalización en DB y memoria
- ✅ Bloqueo instantáneo de accesos no autorizados

**Ubicación**: `Authentication > Geo-Fencing`

**Flujo:**
1. Cliente hace petición → Middleware extrae IP
2. IP se consulta en caché → Si no existe, consulta API externa
3. Se compara país con lista blanca → Si no está, se registra brecha
4. Se bloquea acceso (opcional) y se notifica a administradores

---

### 3. **Security Dashboard (Centro de Comando)**
Panel centralizado para monitoreo de amenazas y análisis de seguridad.

**Métricas Disponibles:**
- 📊 **Total Checks**: Peticiones totales analizadas
- 🚫 **Blocked Threats**: Amenazas bloqueadas
- 💚 **Health Score**: Puntuación de salud del sistema
- ⚡ **Last Breach**: Última brecha detectada

**Visualizaciones:**
- Mapa de distribución geográfica de amenazas
- Top 5 países con más eventos de seguridad
- Top 5 IPs ofensoras
- Timeline de alertas (últimas 24 horas)
- Estado de RBAC Guard

**Ubicación**: `Authentication > Security Hub`

---

### 4. **Email Notifications (Alertas por Correo)**
Sistema de notificaciones en tiempo real para eventos críticos de seguridad.

**Tipos de Alertas:**
- 🌍 **Geo Breach**: Acceso desde país no autorizado
- 🔒 **Unauthorized Access**: Intentos fallidos de autenticación
- ⚠️ **Rate Limit Exceeded**: Patrones de solicitudes sospechosos

**Características:**
- ✅ Multi-destinatario (múltiples emails)
- ✅ Configuración granular de tipos de alerta
- ✅ Envío asíncrono (no afecta rendimiento)
- ✅ Activación/desactivación individual

**Ubicación**: `Authentication > Alert Notifications`

**Formato de Email:**
```
Subject: ⚠️ SECURITY ALERT: Geographic Access Breach

A critical security event has been detected:

Type: Geographic Access Breach
Details: IP: 185.20.12.3 from Russia, Moscow attempted to access POST /api/collections/users/records

Date: Mon, 03 Feb 2026 14:30:00 EST
Action Required: Check your OzyBase Dashboard immediately.
```

---

### 5. **Audit Logs (Registro de Auditoría)**
Registro completo de todas las peticiones con información geográfica.

**Datos Registrados:**
- User ID (si está autenticado)
- IP Address
- HTTP Method & Path
- Status Code & Latency
- **Country & City** (geolocalización)
- User Agent
- Timestamp

**Almacenamiento**: Tabla `_v_audit_logs` (últimos 100 en memoria, todos en DB)

**Ubicación**: `Observability > Logs & Analytics`

---

### 6. **Health Advisor (Asesor de Salud)**
Sistema de recomendaciones proactivas para mejorar la seguridad.

**Checks Automáticos:**
- ✅ Colecciones sin RLS habilitado
- ✅ Colecciones con reglas públicas de listado
- ✅ Índices faltantes en columnas frecuentes
- ✅ **Alertas de seguridad no resueltas**

**Ubicación**: `Dashboard > Advisors`

---

## 🚀 Configuración Rápida (Quick Start)

### Paso 1: Habilitar Geo-Fencing
```bash
# 1. Navega a Authentication > Geo-Fencing
# 2. Activa el toggle "Enabled"
# 3. Agrega países permitidos (ej: United States, Spain, Colombia)
# 4. Guarda cambios
```

### Paso 2: Configurar Notificaciones
```bash
# 1. Navega a Authentication > Alert Notifications
# 2. Agrega tu email (ej: admin@company.com)
# 3. Selecciona tipos de alerta (por defecto: todas)
# 4. Haz clic en "Add"
```

### Paso 3: Configurar RBAC
```bash
# 1. Navega a Authentication > Permissions
# 2. Selecciona una colección (ej: "users")
# 3. Configura reglas:
#    - List: auth (solo usuarios autenticados)
#    - Create: admin (solo administradores)
#    - Update: admin
#    - Delete: admin
# 4. Los cambios se aplican instantáneamente
```

### Paso 4: Monitorear Dashboard
```bash
# 1. Navega a Authentication > Security Hub
# 2. Revisa métricas en tiempo real
# 3. Investiga cualquier "Blocked Threat"
# 4. Verifica la lista de "Top Offenders"
```

---

## 📊 Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT REQUEST                            │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              MIDDLEWARE STACK                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. CORS & Security Headers                          │   │
│  │  2. Rate Limiting                                    │   │
│  │  3. JWT Authentication (AuthMiddleware)              │   │
│  │  4. RBAC Check (AccessMiddleware)                    │   │
│  │  5. Metrics & Geo-Tracking (MetricsMiddleware)       │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              GEO-FENCING ENGINE                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  • Extract IP from Request                           │   │
│  │  • Query Geo Cache (Memory → DB → API)              │   │
│  │  • Compare Country with Whitelist                    │   │
│  │  • If Breach → Log Alert + Notify                    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              NOTIFICATION SYSTEM                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  • Query Active Recipients from DB                   │   │
│  │  • Send Emails Asynchronously (Goroutines)           │   │
│  │  • Log Notification Delivery                         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              DATABASE PERSISTENCE                            │
│  • _v_audit_logs (All requests)                             │
│  • _v_security_alerts (Breaches)                            │
│  • _v_security_policies (Geo-Fencing config)                │
│  • _v_security_notification_recipients (Email list)         │
│  • _v_ip_geo (Geo cache)                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 API Endpoints de Seguridad

### Geo-Fencing
```http
GET    /api/project/security/policies
POST   /api/project/security/policies
```

### Security Stats
```http
GET    /api/project/security/stats
```

### Notifications
```http
GET    /api/project/security/notifications
POST   /api/project/security/notifications
DELETE /api/project/security/notifications/:id
```

### RBAC
```http
PATCH  /api/collections/rules
```

### Audit Logs
```http
GET    /api/project/logs
```

---

## 🛠️ Tablas de Base de Datos

| Tabla | Propósito |
|-------|-----------|
| `_v_audit_logs` | Registro completo de peticiones con geolocalización |
| `_v_security_alerts` | Alertas de seguridad (brechas, accesos no autorizados) |
| `_v_security_policies` | Configuración de políticas (Geo-Fencing, etc.) |
| `_v_security_notification_recipients` | Lista de emails para notificaciones |
| `_v_ip_geo` | Caché de geolocalización de IPs |
| `_v_collections` | Metadatos de colecciones (incluye reglas RBAC) |

---

## 📈 Mejores Prácticas

### 1. **Configuración Inicial**
- ✅ Habilita Geo-Fencing solo para países donde operas
- ✅ Configura al menos 2 destinatarios de notificaciones
- ✅ Establece reglas RBAC restrictivas por defecto (`admin` para create/update/delete)
- ✅ Revisa el Security Dashboard diariamente

### 2. **Monitoreo Continuo**
- ✅ Investiga cada "Blocked Threat" en el dashboard
- ✅ Revisa los "Top Offenders" semanalmente
- ✅ Analiza el timeline de alertas para detectar patrones
- ✅ No ignores las notificaciones por email

### 3. **Respuesta a Incidentes**
- ✅ Tiempo de respuesta objetivo: **15 minutos** para alertas críticas
- ✅ Documenta cada brecha investigada
- ✅ Actualiza políticas basándote en incidentes
- ✅ Considera bloquear IPs ofensoras a nivel de firewall

### 4. **Mantenimiento**
- ✅ Limpia `_v_audit_logs` periódicamente (retención: 30-90 días)
- ✅ Marca alertas como resueltas: `UPDATE _v_security_alerts SET is_resolved = true WHERE id = ?`
- ✅ Revisa y actualiza la lista de destinatarios de notificaciones
- ✅ Prueba el sistema de notificaciones mensualmente

---

## 🐛 Troubleshooting

### Problema: Las notificaciones no se envían
**Solución:**
```sql
-- Verificar destinatarios activos
SELECT * FROM _v_security_notification_recipients WHERE is_active = true;

-- Verificar alertas pendientes
SELECT * FROM _v_security_alerts WHERE is_resolved = false ORDER BY created_at DESC LIMIT 10;
```

### Problema: Geo-Fencing no bloquea
**Solución:**
```sql
-- Verificar política habilitada
SELECT config FROM _v_security_policies WHERE type = 'geo_fencing';

-- Debería retornar: {"enabled": true, "allowed_countries": ["United States", ...]}
```

### Problema: RBAC no funciona
**Solución:**
```sql
-- Verificar reglas de colección
SELECT name, list_rule, create_rule, update_rule, delete_rule FROM _v_collections;

-- Verificar que el middleware está aplicado en las rutas
```

---

## 📚 Documentación Adicional

- [RBAC Configuration Guide](./RBAC.md)
- [Geo-Fencing Setup](./GEO_FENCING.md)
- [Security Notifications](./SECURITY_NOTIFICATIONS.md)
- [Security Dashboard](./SECURITY_DASHBOARD.md)

---

## 🎯 Roadmap de Seguridad

### Próximas Características
- [ ] Integración con Slack/Discord para notificaciones
- [ ] Autenticación de dos factores (2FA)
- [ ] Análisis de comportamiento con ML
- [ ] Bloqueo automático de IPs sospechosas
- [ ] Exportación de logs a SIEM (Splunk, ELK)
- [ ] Auditoría de cambios en configuración de seguridad

---

**Versión**: 1.0.0  
**Última actualización**: 2026-02-03  
**Mantenido por**: OzyBase Security Team

---

## 🤝 Contribuciones

¿Encontraste un bug de seguridad? Repórtalo de forma responsable a: security@ozybase.io

**NO** publiques vulnerabilidades de seguridad en issues públicos.
