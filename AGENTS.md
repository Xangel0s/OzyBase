# Agents.md - Project Tracking

## General Overview
This project is an Admin Panel for a Backend-as-a-Service (BaaS) system named OzyBase/BAAS. It includes a frontend built with React, Vite, and TailwindCSS, and a backend built in Go.

## Current State
- **Frontend**: Functional table editor, connection management, SQL editor, and realtime updates.
- **Backend**: Go-based API handling schema discovery, table data, views, and realtime events.
- **Recent Changes**: Modernized Storage Manager with hierarchical folder support, advanced file actions (Rename/Move), and a professional explorer UI. Refactored Connection Modal to a minimalist design. Implemented Table Context Menu for row/cell actions. Standardized backgrounds and typography across all modules to the "Hybrid Premium" theme.

## Conventions
- **Naming**: Descriptive names, PascalCase for components, camelCase for variables/functions.
- **Styling**: TailwindCSS with premium aesthetics (dark mode, rounded corners, subtle animations).
- **Communication**: Frontend and Backend interact via REST API with auth tokens.

- [x] Implemented hierarchy and folder support in Storage.
- [x] Standardized backgrounds (#111111) and headers (#131313).
- [x] Modernized OzyEngramChat sidebar with chronicle copy action.
- [x] Removed deprecated Consola (Pulse) tab from Agent Forge.
- [x] Repaired structural corruption, syntax errors, and secondary duplication in `useAgentNexus` hook and `AgentForge` component.
- [x] Finalized "Nexus Directory" redesign for Agent Forge sidebar and governance interfaces.
- [x] Standardized premium "Hybrid Premium" aesthetic with rounded-2xl/3xl containers across Agent Forge and OzyEngramChat.
- [x] Implemented "Copy to Clipboard" for OzyEngram memory chronicle.

## Decisions Made
- Replaced visual truncation of long fields with a right-click context menu (Supabase style) for better UX.
- Simplified Connection Modal into "Access", "Connection", and "API" tabs.
- Used Python scripts for precise structural patching of AgentForge.tsx (1700+ lines) to resolve complex syntax and scoping errors without manual rework.
