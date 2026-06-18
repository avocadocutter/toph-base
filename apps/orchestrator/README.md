# tophbase

[![CI](https://github.com/avocadocutter/toph-base/actions/workflows/ci.yml/badge.svg)](https://github.com/avocadocutter/toph-base/actions/workflows/ci.yml)
![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-D97757?logo=claude&logoColor=fff)

I love Supabase. But spinning it up locally means Docker, a heavy CLI, and a cloud account before you've written a single line of code. tophbase gives you a Supabase-compatible local backend with one command — free, no Docker, no setup. Build your MVP locally, graduate to Railway, and eventually to real Supabase when you're ready.

Early and evolving — expect rough edges. Issues and PRs are welcome.

This project is built with AI assistance ([Claude Code](https://claude.ai/code)). All code is reviewed and understood by the maintainer before merge.

---

## Quick Start

```bash
npx tophbase freshman
```

That's it. On first run, tophbase asks you a few questions (port, migrations directory, whether to enable the Postgres wire protocol) and saves your answers. Every subsequent run just starts — no prompts.

Open `http://localhost:<your-port>` to access the dashboard.

---

## Connect with Postico, psql, or any Postgres client

tophbase can expose a Postgres wire protocol server so you can connect with any standard Postgres client — Postico, TablePlus, psql, whatever you use.

Enable it during `freshman` setup, or pass the flag directly:

```bash
npx tophbase freshman --pg-wire-port 5433
```

Then connect with:

```
Host:     127.0.0.1
Port:     <pg-wire-port>
Database: postgres
User:     postgres
Password: (leave blank)
```

---

## Local → Railway → Supabase

`graduate` deploys your local tophbase instance to a hosted environment — same behavior as local, just hosted.

```bash
npx tophbase graduate --provider railway
```

Railway is supported today. `graduate --provider supabase` is on the roadmap — we're aiming for it but need more real-world usage and testing to get there. Try it, break it, open issues.

---

## Other commands

### `tophbase schema refresh`

Regenerates `SCHEMA.md` from the current local database state — useful as context for AI tools.

```bash
npx tophbase schema refresh
```

---

## Supabase Compatibility

tophbase runs PostgreSQL 17 (via [PGlite](https://pglite.dev)) and is designed to make any Supabase migration apply cleanly locally.

For a typical vibe dev app (SQL + REST API + email auth + RLS + extensions + storage), compatibility is **~95%**. The main gaps are Realtime, OAuth, and Edge Functions.

| Feature | Status | Notes |
|---|---|---|
| SQL, schemas, triggers, functions, RLS | ✅ Identical | |
| REST API (CRUD, filters, upsert, RPC) | ✅ Identical | |
| Auth — email/password, JWT, sessions | ✅ Identical | |
| `auth.uid()` / `auth.role()` / `auth.email()` | ✅ Identical | |
| All standard pg extensions (`pgcrypto`, `pgvector`, `pg_trgm`, `citext`, `uuid-ossp`, `hstore`, `ltree`, `unaccent`, `pg_hashids`, `pg_uuidv7`, `pgtap`, `age`, `pg_ivm`, etc.) | ✅ Identical | ~38 extensions loaded via PGlite |
| `pgjwt` | ✅ Identical | Reimplemented in SQL via pgcrypto |
| Storage (buckets, upload/download, signed URLs, copy/move) | ✅ Identical | Local filesystem backend |
| Storage — per-bucket CORS rules | ⚠️ Not implemented | Global `CORS_ALLOWED_ORIGINS` applies to all routes; per-bucket CORS configuration is not supported |
| `vault` | ⚠️ Simplified | Same API — secrets stored as plaintext locally, no encryption |
| `pg_cron` | ⚠️ Simplified | Same API — jobs run via a Node.js bridge, stops when server stops |
| `pgsodium` | ⚠️ Simplified | Delegates to pgcrypto — basic crypto works, key derivation differs |
| `pg_jsonschema` | ⚠️ No-op | `jsonschema_is_valid()` always returns `true` — constraints not enforced |
| `pg_net` | ❌ Clear error | Not available in local mode |
| `pg_graphql` | ❌ Clear error | Not available in local mode |
| `plv8`, `pgroonga`, `wrappers` | ❌ Clear error | Not available in local mode |
| Auth — OAuth, magic link, MFA | ❌ Not implemented | |
| Realtime | ⚠️ No-op stub | WebSocket endpoint accepts connections and handles heartbeats so `createClient()` doesn't error — no actual event delivery |
| Edge Functions | ⚠️ Partial | Deno-based functions with import map shim; managed via dashboard. Some Deno APIs may differ from Supabase's hosted runtime. |

`CREATE EXTENSION IF NOT EXISTS` for unsupported extensions is stripped by the migration runner — migrations always apply cleanly.

---

## Configuration

tophbase uses [dotenvx](https://dotenvx.com) to load secrets. The default secrets file is `~/.secrets/toph-base.env`.

| Variable | Required | Description | Example |
|---|---|---|---|
| `JWT_PLATFORM_SECRET` | **Required** | Secret for signing platform JWTs. At least 32 characters. | `a-long-random-secret-string-here` |
| `ADMIN_PASSWORD` | **Required** | Bootstrap admin password. | `changeme` |
| `ADMIN_EMAIL` | No | Bootstrap admin email | `admin@toph.local` |
| `GATEWAY_PORT` | No | Port the API listens on | `8000` |
| `GATEWAY_HOST` | No | Host the API binds to | `0.0.0.0` |
| `LOG_LEVEL` | No | Pino log level | `info` |
| `CORS_ALLOWED_ORIGINS` | No | Comma-separated allowed CORS origins | `http://localhost:3000` |
| `ACCESS_TOKEN_EXPIRY` | No | Access token TTL in seconds | `3600` |
| `REFRESH_TOKEN_EXPIRY` | No | Refresh token TTL in seconds | `604800` |
| `RATE_LIMIT_AUTH` | No | Max auth requests per minute | `5` |
| `RATE_LIMIT_API` | No | Max API requests per minute | `100` |
| `ENABLE_SIGNUP` | No | Allow new platform user sign-ups | `true` |
| `REQUIRE_AUTH_FOR_API` | No | Require authentication on REST API endpoints | `true` |
| `PUBLIC_API_URL` | No | Base domain for project-specific API URLs | `http://localhost:8000` |

---

## Architecture

```
toph-base/
├── apps/
│   ├── api/            # Fastify (TypeScript) API — auth, REST, storage, RLS
│   ├── dashboard/      # React 19 + Vite + TailwindCSS admin SPA
│   └── orchestrator/   # tophbase CLI (freshman / graduate / schema)
├── migrations/         # Platform-level SQL migrations
└── scripts/            # Build utilities
```

- **apps/api** — the core server. Runs PGlite (embedded Postgres) in-process — no external database required. Handles JWT auth, per-project RLS, a Supabase-compatible REST API, and storage. Serves the dashboard as static files when built.
- **apps/dashboard** — the admin SPA. Create and manage projects, run SQL queries, manage API keys, and apply migrations from a browser UI.
- **apps/orchestrator** — the `tophbase` CLI. Wires the API and dashboard together, handles `freshman` startup and `graduate` export, and exposes the `schema` command.
- **migrations/** — `schema.sql` initializes the platform database. Applied once on a fresh install.
- **scripts/** — build utilities (e.g. bundling the dashboard into the orchestrator package).

---

## License

See [LICENSE](LICENSE) file.
