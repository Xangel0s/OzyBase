# Self-Hosting OzyBase

## Requisitos

- Docker 24+ con [docker compose plugin](https://docs.docker.com/compose/install/)
- Git
- OpenSSL (para generación de secrets)
- Puerto 8090 libre

## Instalación (1 comando)

```bash
git clone https://github.com/Xangel0s/OzyBase.git
cd OzyBase
bash deploy/setup.sh
```

El script:
1. Verifica dependencias (docker, compose, openssl)
2. Chequea que el puerto 8090 esté libre
3. Genera un `.env` con secrets únicos (JWT, API keys, DB password)
4. Detecta la zona horaria del servidor
5. Crea el directorio `./backups/` para las copias de seguridad
6. Levanta los contenedores (app + PostgreSQL + backup automático)

## Post-instalación

1. Abrir `http://{IP_DEL_SERVIDOR}:8090` en el navegador
2. Completar el Setup Wizard (crear cuenta admin)
3. ¡OzyBase está listo!

## Variables de Entorno Críticas

El `setup.sh` genera el `.env` automáticamente con secrets seguros. Sin embargo,
debes editarlo para estos casos:

| Variable | Obligatoria | Propósito |
|---|---|---|
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Para emails | Invitaciones, reseteo de contraseñas, alertas de seguridad |
| `SITE_URL` | Para producción | Cambiar de `http://127.0.0.1:8090` a tu dominio real |
| `APP_DOMAIN` | Para producción | Tu dominio (ej: `tudominio.com`) |

```bash
nano .env
# Editar SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SITE_URL, APP_DOMAIN
docker compose restart ozybase
```

## HTTPS — Configurar Reverse Proxy

### Opción recomendada: Caddy (el más simple)

Caddy obtiene SSL automáticamente vía Let's Encrypt.

```caddy
# Caddyfile
base.tudominio.com {
    reverse_proxy localhost:8090
}
```

```bash
docker run -d \
    -p 80:80 -p 443:443 \
    -v $PWD/Caddyfile:/etc/caddy/Caddyfile \
    -v caddy_data:/data \
    caddy:2
```

### Opción alternativa: Nginx

La configuración de Nginx está incluida en el repositorio:

```bash
cp deploy/nginx/ozybase.conf /etc/nginx/sites-available/
ln -s /etc/nginx/sites-available/ozybase.conf /etc/nginx/sites-enabled/
# Editar el archivo con tu dominio y certificados SSL
systemctl reload nginx
```

## Backups

Las copias de seguridad se ejecutan automáticamente cada 24 horas.
Se almacenan en la carpeta `./backups/` del proyecto.

```bash
# Listar backups disponibles
ls -lh backups/

# Copiar un backup a otro servidor
cp backups/*.sql.gz /mnt/backups-remotos/

# Configuración
# - Retención: 14 días (limpia automático)
# - Compresión: gzip
# - Horario: @daily (configurable via SCHEDULE en docker-compose.yml)
```

**⚠️ La carpeta `./backups/` y el volumen `postgres_data` son sagrados.**
Sin ellos, la recuperación ante desastres es imposible. Inclúyelos en tu
estrategia de backups externos (rsync, rclone, S3, etc.).

## Actualizar OzyBase

```bash
cd OzyBase
docker compose down
git pull
docker compose pull          # actualizar imágenes base (Postgres, backup)
docker compose up -d --build # reconstruir la imagen de OzyBase
```

## Comandos Útiles

```bash
# Ver logs en vivo
docker compose logs -f ozybase

# Ver estado de los contenedores
docker compose ps

# Backup manual inmediato
docker compose exec db-backup /backup.sh

# Restaurar desde backup
gunzip < backups/backup-*.sql.gz | docker compose exec -T db psql -U postgres -d ozybase

# Detener todo
docker compose down

# Detener y eliminar volúmenes (⚠️ destruye datos)
docker compose down -v
```

## Monitoreo

OzyBase expone un endpoint de health check en `/api/health`:
- Usado por Docker para reinicio automático si el binario falla
- Compatible con Uptime Kuma, Prometheus, Healthchecks.io, etc.

## Requisitos de Hardware Recomendados

| Recurso | Mínimo | Recomendado |
|---|---|---|
| RAM | 1 GB | 2 GB |
| CPU | 1 núcleo | 2 núcleos |
| Disco | 10 GB | 20 GB + backups |

## Solución de Problemas

**Error: `port is already allocated`**
```bash
# Cambiar el puerto en .env
PORT=8091
docker compose up -d
```

**Error: `connection refused` a PostgreSQL**
```bash
docker compose logs db
docker compose restart db
# Esperar 10 segundos a que el healthcheck pase
```

**Error: `.env already exists` al ejecutar setup.sh**
El script es intencionalmente idempotente. Para regenerar:
```bash
mv .env .env.bak
bash deploy/setup.sh
```
