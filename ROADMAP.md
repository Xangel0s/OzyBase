# 🎯 ROADMAP CONSOLIDADO - OzyBase

## Fase 0: Fundación (Semanas 1-2) - Seguridad y Estabilidad
> *Enfoque: Asegurar que la base sea inquebrantable.*

- [x] **Security Audit Completo**
    - [x] `gosec` para escaneo de vulnerabilidades en código Go. (En progreso/Configurado)
    - [ ] `trivy` para escaneo de vulnerabilidades en contenedores/dependencias.
    - [x] Rate limiting robusto por IP y usuario.
    - [x] CORS whitelist configurable vía variables de entorno.
    - [x] Secrets management: Auditoría para asegurar que no hay secretos en código.
- [ ] **Testing Obligatorio**
    - [ ] Alcanzar 70% de cobertura mínima.
    - [ ] Tests de integración con PostgreSQL real.
    - [x] Configuración de GitHub Actions para CI/CD continuo.
    - [ ] Load testing básico con `k6`.
- [x] **Quick Wins**
    - [x] Health check endpoint detallado.
    - [x] Logging estructurado con `zerolog` o `zap`.
    - [ ] Métricas básicos.

## Fase 1: Features Críticas (Semanas 3-5) - Autenticación y Datos
- [x] **Auth Completo**
    - [x] Email verification (Signup workflow).
    - [ ] Social Login (OAuth2) - Google/GitHub.
    - [x] Roles y Permisos granulares (RBAC).
- [ ] **Data Handling Avanzado**
    - [x] Soft deletes (`deleted_at`).
    - [ ] Query builder avanzado (filtros complejos).
    - [ ] Backup/restore automatizado y programado.
    - [ ] Row Level Security (RLS) integrado en el Dashboard.
- [ ] **Developer Experience (DX)**
    - [ ] Guía de despliegue en producción.
    - [ ] Documentación de Troubleshooting.
    - [ ] Especificación OpenAPI (Swagger) siempre actualizada.

## Fase 2: Production Ready (Semanas 6-8) - Infraestructura y Observabilidad
- [ ] **Infraestructura**
    - [ ] Docker Compose listo para producción.
    - [ ] Configuración optimizada de Nginx como Reverse Proxy.
    - [ ] SSL/TLS automático con Let's Encrypt.
- [ ] **Observability**
    - [ ] Exportador de métricas para Prometheus.
    - [ ] Dashboards de Grafana pre-configurados.
    - [ ] Centralización de logs estructurados en JSON.
- [ ] **Realtime Mejorado**
    - [ ] Integración de Redis PubSub para escalabilidad horizontal.
    - [ ] Lógica de reconexión automática en el cliente.

## Fase 3: Launch v1.0 (Semanas 9-10) - Salida al Mercado
- [ ] Beta testing con usuarios reales.
- [ ] Auditoría de seguridad externa.
- [ ] Publicación de benchmarks de rendimiento.
- [ ] Documentación final "Golden Edition".

---

## 🚨 Showstoppers Finales (Consenso Crítico)
*No se lanza la v1.0 sin cumplir esto:*
1. **Tests Automatizados (70% coverage) + CI/CD**.
2. **Email Verification + Password Reset**.
3. **Security Audit Completo (gosec, trivy)**.
4. **Backups Automatizados**.
5. **Row Level Security (RLS)**.
6. **Migrations System**.
7. **Production Deployment Docs**.

---

## 📊 Tabla de Prioridades Consolidada

| Feature | Prioridad Consenso | Motivo |
| :--- | :--- | :--- |
| **Testing + CI/CD** | 🔴 CRÍTICA | Vital para la estabilidad a largo plazo. |
| **Email verification** | 🔴 ALTA | Estándar de seguridad para producción. |
| **RLS (Row Level Security)** | 🔴 CRÍTICA | Diferenciador clave de OzyBase y seguridad de datos. |
| **WebSockets** | 🟡 MEDIA (v1.5) | Importante, pero la v1.0 puede vivir con polling robusto/RT básico. |
| **Migrations** | 🔴 ALTA | Gestión profesional de base de datos. |
| **Backups** | 🔴 ALTA | Sin backups no hay producción. |
| **Edge Functions** | 🟢 BAJA (v2.0) | Feature avanzada para el futuro. |
| **Observability** | 🟡 MEDIA | Necesario para monitoreo en vivo. |
| **OAuth Providers** | 🟡 MEDIA (v1.2) | Mejora la experiencia, pero no bloquea el lanzamiento. |
