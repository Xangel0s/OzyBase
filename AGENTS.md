# OzyBase - Agents Guideline

## Project Overview
OzyBase is a fullstack web application featuring a Go backend (similar to PocketBase) and a Vite/React frontend.

## Architecture
- **Backend**: Go application located under `./cmd/OzyBase` and `./internal`.
- **Frontend**: Single Page Application under `./frontend` running Vite and React.

## Execution / Development
To start the services:
- Run `.\start.bat` on Windows to launch both Backend and Frontend.
- Or start them individually:
  - **Backend**: `go run ./cmd/OzyBase` (runs on http://localhost:8090)
  - **Frontend**: `cd frontend && npm run dev` (runs on http://localhost:5342)
