# Self-Hosting OzyBase

## Prerequisites

- Docker 24+ with [docker compose plugin](https://docs.docker.com/compose/install/)
- Git
- OpenSSL (for secret generation)
- Free port 8090

## Installation (One-line command)

```bash
git clone https://github.com/Xangel0s/OzyBase.git
cd OzyBase
bash deploy/setup.sh
```

The script:
1. Verifies dependencies (docker, compose, openssl)
2. Checks if port 8090 is available
3. Generates `.env` with unique secrets (JWT, API keys, DB password)
4. Detects server timezone
5. Creates `./backups/` directory for automatic database backups
6. Starts containers (app + PostgreSQL + automated backup runner)

## Post-Installation

1. Open `http://{SERVER_IP}:8090` in your browser
2. Complete the Setup Wizard (create initial admin account)
3. OzyBase is ready for production!

## Critical Environment Variables

The `setup.sh` script automatically generates a secure `.env`. However, you should update it for the following cases:

| Variable | Required | Purpose |
|---|---|---|
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | For emails | Team invitations, password resets, security alerts |
| `SITE_URL` | For production | Update from `http://127.0.0.1:8090` to your public domain |
| `APP_DOMAIN` | For production | Your domain name (e.g. `yourdomain.com`) |

```bash
nano .env
# Edit SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SITE_URL, APP_DOMAIN
docker compose restart ozybase
```

## HTTPS — Reverse Proxy Setup

### Recommended Option: Caddy (simplest)

Caddy automatically provisions SSL certificates via Let's Encrypt.

```caddy
# Caddyfile
base.yourdomain.com {
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

### Alternative Option: Nginx

Nginx configuration is included in the repository:

```bash
cp deploy/nginx/ozybase.conf /etc/nginx/sites-available/
ln -s /etc/nginx/sites-available/ozybase.conf /etc/nginx/sites-enabled/
# Edit the configuration file with your domain and SSL certificates
systemctl reload nginx
```

## Backups

Backups run automatically every 24 hours and are stored in `./backups/`.

```bash
# List available backups
ls -lh backups/

# Copy backup to remote server
cp backups/*.sql.gz /mnt/remote-backups/

# Backup Configuration
# - Retention: 14 days (automatic cleanup)
# - Compression: gzip
# - Schedule: @daily (configurable via SCHEDULE in docker-compose.yml)
```

**⚠️ The `./backups/` folder and `postgres_data` volume are critical.**
Include them in your offsite backup strategy (rsync, rclone, S3, etc.).

## Updating OzyBase

```bash
cd OzyBase
docker compose down
git pull
docker compose pull          # update base images
docker compose up -d --build # rebuild OzyBase image
```

## Useful Commands

```bash
# View live logs
docker compose logs -f ozybase

# Check container status
docker compose ps

# Trigger manual backup immediately
docker compose exec db-backup /backup.sh

# Restore from backup
gunzip < backups/backup-*.sql.gz | docker compose exec -T db psql -U postgres -d ozybase

# Stop containers
docker compose down

# Stop and remove volumes (⚠️ destroys data)
docker compose down -v
```

## Health Monitoring

OzyBase exposes a health check endpoint at `/api/health`:
- Used by Docker for automatic restart if the process fails
- Compatible with Uptime Kuma, Prometheus, Healthchecks.io, etc.

## Hardware Requirements

| Resource | Minimum | Recommended |
|---|---|---|
| RAM | 1 GB | 2 GB |
| CPU | 1 Core | 2 Cores |
| Storage | 10 GB | 20 GB + Backups |

## Troubleshooting

**Error: `port is already allocated`**
```bash
# Change port in .env
PORT=8091
docker compose up -d
```

**Error: `connection refused` to PostgreSQL**
```bash
docker compose logs db
docker compose restart db
# Wait 10 seconds for healthcheck to pass
```

**Error: `.env already exists` when running setup.sh**
The script is intentionally idempotent. To regenerate:
```bash
mv .env .env.bak
bash deploy/setup.sh
```
