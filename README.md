# FlowKore Core 🚀

The high-performance, open-source Backend-as-a-Service (BAAS) framework written in Go.

FlowKore allows you to create dynamic collections, manage authentication, handle real-time subscriptions, and store files with minimal configuration.

## Features ✨

- **🚀 High Performance**: Built with Go and Echo for maximum speed and efficiency.
- **🏗️ Meta-Schema Ops**: Create and modify database collections via API at runtime.
- **🔐 Auth System**: Built-in JWT authentication with granular ACL (Public/Auth/Admin).
- **⚡ Real-time**: Instant data synchronization using Server-Sent Events (SSE) and Postgres LISTEN/NOTIFY.
- **📂 Storage**: Simple local file storage management.
- **🛠️ JS SDK**: Zero-dependency JavaScript SDK for seamless frontend integration.

## Tech Stack

- **Languaje**: Go (Golang)
- **Database**: PostgreSQL
- **Web Framework**: Echo
- **Auth**: JWT (HS256)
- **Events**: SSE + Postgres Notify

## Quick Start

1. **Clone the repo**
2. **Setup environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your PostgreSQL credentials
   ```
3. **Run the server**:
   ```bash
   go build ./cmd/flowkore
   ./flowkore
   ```

## API Documentation

- `POST /api/auth/signup` - User registration
- `POST /api/auth/login` - Get access token
- `GET /api/realtime` - Subscribe to SSE events
- `POST /api/collections` - Create dynamic tables
- `GET /api/collections/:name/records` - List dynamic data

---
Developed with ❤️ by Xangel0s.
