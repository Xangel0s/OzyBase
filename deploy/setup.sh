#!/bin/bash
# deploy/setup.sh
# OzyBase — One-command production setup
# Uso: bash deploy/setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "  OZYBASE PRODUCTION SETUP"
echo "  ========================"
echo ""

# --------------------------------------------------
# 1. Dependency check
# --------------------------------------------------
echo "[STEP 1/5] Checking dependencies..."

DEPS_FAIL=0
command -v docker >/dev/null 2>&1 || { echo "  MISSING: docker"; DEPS_FAIL=1; }
docker compose version >/dev/null 2>&1 || { echo "  MISSING: docker compose plugin"; DEPS_FAIL=1; }
command -v openssl >/dev/null 2>&1 || { echo "  MISSING: openssl"; DEPS_FAIL=1; }

if [ "$DEPS_FAIL" -eq 1 ]; then
    echo "  FAILED (install missing dependencies and retry)"
    exit 1
fi
echo "  DONE (docker, compose, openssl)"

# --------------------------------------------------
# 2. Port check
# --------------------------------------------------
echo "[STEP 2/5] Checking port ${PORT:-8090}..."

PORT=${PORT:-8090}
PORT_BUSY=0
if command -v ss >/dev/null 2>&1; then
    if ss -tlnp "sport = :$PORT" 2>/dev/null | grep -q ":$PORT"; then
        PORT_BUSY=1
    fi
elif command -v netstat >/dev/null 2>&1; then
    if netstat -tlnp 2>/dev/null | grep -q ":$PORT "; then
        PORT_BUSY=1
    fi
fi

if [ "$PORT_BUSY" -eq 1 ]; then
    echo "  FAILED (port $PORT is already in use)"
    exit 1
fi
echo "  DONE (available)"

# --------------------------------------------------
# 3. Generate credentials
# --------------------------------------------------
echo "[STEP 3/5] Generating credentials..."

if [ -f ".env" ]; then
    echo "  SKIPPED (.env already exists)"
else
    bash deploy/keygen.sh
    echo "  DONE (.env created with unique keys)"
fi

# Detect timezone if not set
TZ_VALUE="UTC"
if grep -q "^TZ=" .env 2>/dev/null; then
    TZ_VALUE=$(grep "^TZ=" .env | cut -d= -f2)
else
    TZ_DETECTED=$(timedatectl show --property=Timezone --value 2>/dev/null || echo "")
    if [ -n "$TZ_DETECTED" ]; then
        TZ_VALUE="$TZ_DETECTED"
        echo "TZ=$TZ_VALUE" >> .env
    fi
fi

# --------------------------------------------------
# 4. Validate SMTP
# --------------------------------------------------
echo "[STEP 4/5] Validating SMTP..."

if grep -qE "^SMTP_HOST=.+" .env 2>/dev/null; then
    echo "  DONE (SMTP configured)"
else
    echo "  SKIPPED (default profile)"
fi

# --------------------------------------------------
# 5. Start infrastructure
# --------------------------------------------------
echo "[STEP 5/5] Starting OzyBase..."

mkdir -p backups
docker compose up -d

# Detect IP
IP_ADDR=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo ""
echo "+------------------------------------------------------------+"
echo "|              OZYBASE DEPLOYMENT SUCCESSFUL                 |"
echo "+------------------------------------------------------------+"
printf "| URL:        http://%-30s:%-4s |\n" "$IP_ADDR" "$PORT"
echo "| Backups:    Active (Daily, 14-day retention)               |"
printf "| Timezone:   %-47s |\n" "$TZ_VALUE"
echo "| Security:   STRICT_MODE enabled                            |"
echo "+------------------------------------------------------------+"
echo "| NEXT STEP: Configure Nginx/Caddy for HTTPS                 |"
echo "+------------------------------------------------------------+"
echo ""
echo "  Logs:     docker compose logs -f ozybase"
echo "  Stop:     docker compose down"
echo "  Backups:  ls -lh backups/"
echo ""
