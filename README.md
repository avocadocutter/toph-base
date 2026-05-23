# toph-base

[![CI](https://github.com/avocadocutter/toph-base/actions/workflows/ci.yml/badge.svg)](https://github.com/avocadocutter/toph-base/actions/workflows/ci.yml)
![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-D97757?logo=claude&logoColor=fff)

A local Supabase-compatible backend you can run inside any project — no Docker, no external database.

Built and maintained by [avocadocutter](https://github.com/avocadocutter). Early and evolving — expect rough edges. Issues and PRs are welcome.

This project is built with AI assistance ([Claude Code](https://claude.ai/code)). All code is reviewed and understood by the maintainer before merge.

---

## freshman & graduate

Two commands drive the full lifecycle:

### `tophbase freshman`

Starts a local Supabase-compatible backend inside your project. On first run it prompts for a port, a migrations directory, and whether to expose a Postgres wire protocol server (for connecting with tools like Postico or `psql`). Answers are saved to `.tophbase/config.json`; subsequent runs use the saved config — no prompts.

```bash
tophbase freshman
# or override saved config:
tophbase freshman --port 8000 --migrations-dir ./supabase/migrations
# enable the Postgres wire protocol server on a specific port:
tophbase freshman --pg-wire-port 5433
```

The Postgres wire protocol server is **opt-in**. When enabled, tophbase exposes a TCP listener that speaks the PostgreSQL wire protocol, backed by the embedded PGlite instance. This lets you connect with any standard Postgres client:

```
Host:     127.0.0.1
Port:     <pg-wire-port>
Database: postgres
User:     postgres
Password: (leave blank)
```

If you pass `--pg-wire-port`, it overrides the saved value. If no port is saved and the flag is omitted, the interactive prompt asks whether to enable it — and if you answer yes, a port is **required** (no default).

Everything lives in `.tophbase/` in the current directory (data, config). Add `.tophbase/` to your `.gitignore`.

### `tophbase graduate` _(not yet ready)_

The plan: when you're ready to go to production, `graduate` will export your local PGlite database and apply it to a real Postgres instance. The command exists and accepts a `--provider` flag (`railway`, `supabase`, `neon`, `postgres`), but the export is incomplete — it currently only handles `public` schema base tables (columns, PKs, unique constraints, foreign keys, and row data). Views, functions, triggers, enums, indexes, check constraints, other schemas (`auth`, `storage`, `cron`), and storage files on disk are not exported. Don't use it for real data yet.

### `tophbase schema refresh`

Regenerates `SCHEMA.md` from the current local database state — useful as context for AI tools.

```bash
tophbase schema refresh
```

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

- **apps/api** — the core server. Runs PGlite (embedded Postgres) in-process — no external database required. Handles JWT auth, per-project RLS, a Supabase-compatible REST API, and storage. Serves the dashboard as static files in production.
- **apps/dashboard** — the admin SPA. Create and manage projects, run SQL queries, manage API keys, and apply migrations from a browser UI.
- **apps/orchestrator** — the `tophbase` CLI. Wires the API and dashboard together, handles `freshman` startup and `graduate` export, and exposes the `schema` command.
- **migrations/** — `schema.sql` initializes the platform database. Applied once on a fresh install.
- **scripts/** — build utilities (e.g. bundling the dashboard into the orchestrator package).

---

## Prerequisites

- Node.js >= 20
- pnpm 10 (`npm install -g pnpm@10`)
- [dotenvx](https://dotenvx.com) (`npm install -g @dotenvx/dotenvx`)

No external database needed — Postgres runs embedded via [PGlite](https://pglite.dev).

---

## Quick Start

**1. Clone and install**

```bash
git clone https://github.com/avocadocutter/toph-base.git
cd toph-base
pnpm install
```

**2. Configure secrets**

```bash
cp apps/api/.env.example ~/.secrets/toph-base.env
```

Open `~/.secrets/toph-base.env` and set at minimum `JWT_PLATFORM_SECRET` (32+ chars) and `ADMIN_PASSWORD`.

**3. Start**

```bash
pnpm dev
```

- Dashboard: http://localhost:3000
- API: http://localhost:8000

Log in with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

**4. Using the CLI in your own project**

Build the CLI first, then run `freshman` inside your project directory:

```bash
# from the toph-base repo
pnpm build

# then in your project
node /path/to/toph-base/apps/orchestrator/dist/cli/tophbase.js freshman
```

---

## Configuration

tophbase uses [dotenvx](https://dotenvx.com) to load secrets from outside the repo. The default secrets file is `~/.secrets/toph-base.env`.

| Variable | Required | Description | Example |
|---|---|---|---|
| `JWT_PLATFORM_SECRET` | **Required** | Secret for signing platform JWTs. At least 32 characters. No default. | `a-long-random-secret-string-here` |
| `ADMIN_PASSWORD` | **Required** | Bootstrap admin password. No default. | `changeme` |
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
| `PUBLIC_API_URL` | No | Base domain for project-specific API URLs. Requires wildcard DNS in production. | `http://localhost:8000` |

---

## pnpm Scripts

### Root

| Command | Description |
|---|---|
| `pnpm install` | Install dependencies for all apps |
| `pnpm dev` | Start API and dashboard in parallel |
| `pnpm build` | Build all apps for production |
| `pnpm test` | Run the API test suite |

### Per-app

| Command | Description |
|---|---|
| `pnpm --filter @tophbase/api dev` | Start the API only (type-check watch) |
| `pnpm --filter @tophbase/api build` | Build the API |
| `pnpm --filter @tophbase/api test` | Run API tests |
| `pnpm --filter @tophbase/api lint` | Lint the API |
| `pnpm --filter @tophbase/dashboard dev` | Start the dashboard dev server |
| `pnpm --filter @tophbase/dashboard build` | Build the dashboard |
| `pnpm --filter @tophbase/dashboard lint` | Lint the dashboard |

---

## Supabase Compatibility

Tophbase runs PostgreSQL 17 (via [PGlite](https://pglite.dev)) and is designed to make any Supabase migration apply cleanly locally.

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
| `vault` | ⚠️ Simplified | Same API — secrets stored as plaintext locally, no encryption |
| `pg_cron` | ⚠️ Simplified | Same API — jobs run via a Node.js bridge, stops when server stops |
| `pgsodium` | ⚠️ Simplified | Delegates to pgcrypto — basic crypto works, key derivation differs |
| `pg_jsonschema` | ⚠️ No-op | `jsonschema_is_valid()` always returns `true` — constraints not enforced |
| `pg_net` | ❌ Clear error | Not available in local mode |
| `pg_graphql` | ❌ Clear error | Not available in local mode |
| `plv8`, `pgroonga`, `wrappers` | ❌ Clear error | Not available in local mode |
| Auth — OAuth, magic link, MFA | ❌ Not implemented | |
| Realtime | ⚠️ No-op stub | WebSocket endpoint accepts connections and handles heartbeats so `createClient()` doesn't error — no actual event delivery |
| Edge Functions | ❌ Not implemented | |

`CREATE EXTENSION IF NOT EXISTS` for unsupported extensions is stripped by the migration runner — migrations always apply cleanly.

---

## License

See [LICENSE](LICENSE) file.
