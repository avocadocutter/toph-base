# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0.0] - 2026-05-17

### Added
- **Vibebase**: zero-config local BaaS for AI-generated apps — `npx vibebase start` replaces toph-base server platform
- **PGLite storage**: embedded WASM PostgreSQL runs in-process, no Docker or external database required
- **Onboarding UI**: first-run dialect picker in the dashboard (Supabase active; PocketBase/Appwrite coming soon)
- **`vibebase start` CLI**: auto-generates JWT secret + publishable/secret keys on first run, opens browser
- **Supabase-compatible auth**: `/auth/v1/signup`, `/auth/v1/token`, `/auth/v1/logout`, `/auth/v1/user` endpoints matching Supabase JS SDK expectations exactly
- **Realtime WebSocket no-op**: accepts upgrade at `/realtime/v1/websocket`, sends Phoenix heartbeats so `createClient()` never errors
- **Publishable + secret key model**: replaces deprecated anon key with `vb_publishable_...` (client-safe) and `vb_secret_...` (bypasses RLS)
- **`GET /vibebase/status`**: returns dialect, URL, and keys for dashboard wiring
- **`POST /vibebase/setup`**: persists dialect selection to `~/.vibebase/projects/{name}/vibebase-config.json`
- **SCHEMA.md generation**: `vibebase schema refresh` writes AI-readable schema from introspection output
- **`GET /health`**: returns `{ ok: true, version }` with PGLite version string
- **Single-project mode**: eliminates multi-tenant platform catalog; one PGLite instance per project
- **IProtocolAdapter / IDataStore / IGraduationExporter**: clean adapter interface split for future dialect implementations
- **pnpm workspace**: `pnpm dev` from repo root starts both API (:8000) and dashboard (:3000) in parallel
- **Dashboard bundling**: `pnpm build` copies dashboard dist into API package for single-binary deployment

### Removed
- Docker, docker-compose, and PostgreSQL server dependency
- Platform multi-tenancy (projects CRUD, platform users, API keys DB tables)
- Platform auth routes (`/platform/auth/*`)
- Makefile (replaced by `pnpm` scripts in each app)
- `vibebase graduate --to supabase` (graduation concept dropped; product focus is local development)
