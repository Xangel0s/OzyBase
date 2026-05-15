#!/bin/bash
# deploy/keygen.sh
# OzyBase — Generación idempotente de .env para producción
# Ejecutar una sola vez. Si .env ya existe, aborta para no sobrescribir claves.
set -euo pipefail

ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE ya existe. Abortando para proteger tus llaves existentes."
    echo "Si realmente quieres regenerarlo, borra $ENV_FILE manualmente primero."
    exit 1
fi

echo "Generando secrets con openssl..."
JWT_SECRET=$(openssl rand -base64 48)
ANON_KEY=$(openssl rand -base64 48)
SERVICE_ROLE_KEY=$(openssl rand -base64 48)
DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)

cat > "$ENV_FILE" <<EOF
# OzyBase Configuration — Generado por keygen.sh
# NO MODIFIQUES los secrets a menos que sepas lo que haces.

# ============= DEPLOYMENT PROFILE =============
OZY_DEPLOYMENT_PROFILE=self_host
PORT=8090
DEBUG=false

# ============= SITE & DOMAIN =============
SITE_URL=http://127.0.0.1:8090
APP_DOMAIN=localhost
ALLOWED_ORIGINS=http://127.0.0.1:8090,http://localhost:8090

# ============= SECURITY =============
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
OZY_STRICT_SECURITY=true

# ============= DATABASE =============
DB_USER=postgres
DB_PASSWORD=$DB_PASSWORD
DB_NAME=ozybase
DB_SSLMODE=disable
DATABASE_URL=postgres://postgres:${DB_PASSWORD}@db:5432/ozybase?sslmode=disable

# ============= RATE LIMITING =============
RATE_LIMIT_RPS=20
RATE_LIMIT_BURST=20

# ============= SMTP (OPCIONAL) =============
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@localhost

# ============= TIMEZONE =============
TZ=America/Lima

# ============= STORAGE =============
OZY_STORAGE_PROVIDER=local
OZY_STORAGE_PATH=/app/data/storage
EOF

echo "✓ $ENV_FILE generado exitosamente"
echo ""
echo "Resumen de credenciales:"
echo "  JWT_SECRET  = ${JWT_SECRET:0:16}... (${#JWT_SECRET} chars)"
echo "  ANON_KEY    = ${ANON_KEY:0:16}... (${#ANON_KEY} chars)"
echo "  DB_PASSWORD = ${DB_PASSWORD:0:8}... (${#DB_PASSWORD} chars)"
echo ""
echo "⚠️  IMPORTANTE: Revisa y completa SMTP_HOST/SMTP_USER/SMTP_PASSWORD"
echo "   si necesitas emails (reseteo de contraseñas, invitaciones)."
echo "⚠️  Cambia SITE_URL, APP_DOMAIN y ALLOWED_ORIGINS para producción real."
