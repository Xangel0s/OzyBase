# 🚀 OzyBase Production Deployment Guide

This guide provides instructions on how to deploy OzyBase to a production environment.

## 1. Prerequisites
- **PostgreSQL** (v14+)
- **Redis** (optional, recommended for Realtime scalability)
- **Nginx** or another reverse proxy
- **Docker** & **Docker Compose** (recommended)

## 2. Environment Configuration
Create a `.env` file with production values:
```env
# Database
DATABASE_URL=postgres://user:password@db_host:5432/ozybase?sslmode=verify-full

# Server
PORT=8090
ENV=production
DEBUG=false

# Security
JWT_SECRET=generate-a-very-long-random-string
ALLOWED_ORIGINS=https://dashboard.yourdomain.com,https://api.yourdomain.com
RATE_LIMIT_RPS=50
RATE_LIMIT_BURST=100
BODY_LIMIT=20M
```

## 3. Deployment using Docker (Recommended)

### Create a `docker-compose.yml`:
```yaml
version: '3.8'

services:
  ozybase:
    image: xangel0s/ozybase:latest
    ports:
      - "8090:8090"
    env_file: .env
    restart: always
    volumes:
      - ozy_data:/app/data
      - ozy_functions:/app/functions

volumes:
  ozy_data:
  ozy_functions:
```

## 4. Security Recommendations
1. **Enable SSL**: Always use HTTPS. Use Let's Encrypt with Nginx.
2. **Database Hardening**: Do not expose PostgreSQL to the public internet. Use a private network.
3. **Firewall**: Only allow traffic on ports 80 (redirect to 443) and 443.
4. **Regular Backups**: Setup a cron job to backup the `_v_` tables and user data.

## 5. Monitoring & Logs
OzyBase uses structured JSON logging in production. We recommend piping logs to a centralized collector like **Loki**, **Elasticsearch**, or **Datadog**.

Endpoint: `GET /api/health` provides real-time system health and memory metrics.
