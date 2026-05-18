# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Planned
- `tophbase graduate` — full export to cloud Postgres (views, functions, triggers, enums, indexes, auth data, storage files)
- npm publish for `tophbase` CLI global install

---

## [0.1.0] - 2026-05-17

Initial release of toph-base.

### Added
- **`tophbase freshman`** — starts a local Supabase-compatible backend in any project directory. Prompts for port and migrations dir on first run, saves config to `.tophbase/config.json`.
- **`tophbase graduate`** _(partial)_ — scaffolding for exporting local data to a cloud Postgres instance. Currently exports `public` schema base tables only. Views, functions, triggers, enums, and other schemas are not yet exported.
- **`tophbase schema refresh`** — generates `SCHEMA.md` from the live PGlite database for use as AI context.
- **PGlite backend** — embedded WASM Postgres 17 runs in-process via [@electric-sql/pglite](https://pglite.dev). No Docker or external database required.
- **Supabase-compatible REST API** — full CRUD, filters, upsert, RPC via `/rest/v1/:table` and `/rest/v1/rpc/:fn`.
- **Auth** — email/password signup, signin, refresh, logout, and `/auth/v1/user` matching Supabase JS SDK expectations exactly.
- **Storage** — buckets, upload/download, signed URLs, copy, and move backed by the local filesystem.
- **RLS** — per-table enable/disable and policy management. `auth.uid()`, `auth.role()`, `auth.email()` work correctly in policy expressions.
- **~38 PGlite extensions** — including `pgvector`, `pgcrypto`, `pg_trgm`, `citext`, `uuid-ossp`, `hstore`, `ltree`, `age`, `pg_ivm`, `pg_hashids`, `pg_uuidv7`, `pgtap`, and more.
- **Supabase extension stubs** — `vault`, `pg_cron`, `pgsodium`, `pg_jsonschema`, `pg_net`, `pg_graphql` are stubbed so migrations apply cleanly.
- **Realtime no-op** — WebSocket endpoint at `/realtime/v1/websocket` accepts connections and responds to Phoenix heartbeats so `createClient()` never errors. No event delivery.
- **Dashboard** — React 19 + Vite + TailwindCSS admin SPA served as static files from the API in production.
- **CI** — typecheck, lint, test, and build on every push and PR via GitHub Actions.
- **Dependabot** — weekly dependency updates for all apps and GitHub Actions.
