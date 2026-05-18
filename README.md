# toph-base

[![CI](https://github.com/avocadocutter/toph-base/actions/workflows/ci.yml/badge.svg)](https://github.com/avocadocutter/toph-base/actions/workflows/ci.yml)
![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-D97757?logo=claude&logoColor=fff)

A self-hosted database platform with REST API, auth, and a web dashboard.

Inspired by Supabase, toph-base gives you multi-tenant PostgreSQL projects, JWT authentication, row-level security, and a Supabase-compatible REST API — all running on your own infrastructure.

Built and maintained by [avocadocutter](https://github.com/avocadocutter). Early and evolving — expect rough edges. Issues and PRs are welcome.

This project is built with AI assistance ([Claude Code](https://claude.ai/code)). All code is reviewed and understood by the maintainer before merge.

---

## Architecture

```
toph-base/
├── apps/
│   ├── api/          # Fastify (TypeScript) API gateway
│   └── dashboard/    # React 19 + Vite + TailwindCSS admin SPA
├── migrations/       # Platform-level SQL migrations
└── Makefile          # Root orchestration targets
```

- **apps/api** — the API gateway. Handles multi-tenant PostgreSQL connection pooling, JWT-based platform auth, per-project RLS enforcement, and a Supabase-compatible REST API. Bootstraps an admin user on first boot. Serves the dashboard as static files in production.
- **apps/dashboard** — the admin SPA. Lets you create and manage projects, run SQL queries, manage API keys, and apply migrations from a browser UI.
- **migrations/** — `schema.sql` initializes the platform database. Applied once on a fresh install.

---

## Prerequisites

- Node.js >= 20
- pnpm 10 (`npm install -g pnpm@10`)
- PostgreSQL 13+ (local install or any accessible instance)
- [dotenvx](https://dotenvx.com) (`npm install -g @dotenvx/dotenvx`)

---

## Quick Start

**1. Clone the repo**

```bash
git clone https://github.com/avocadocutter/toph-base.git
cd toph-base
```

**2. Configure the API**

This project uses [dotenvx](https://dotenvx.com) to load secrets from a file outside the repo so they can never be accidentally committed. Copy the example to a location of your choice outside the repo:

```bash
cp apps/api/.env.example /your/secrets/toph-base.env
```

By default `make dev` loads from `~/.secrets/toph-base.env`. To use a different path, set `TOPH_SECRETS` in your shell:

```bash
export TOPH_SECRETS=/your/secrets/toph-base.env
```

Open the file and set at minimum:

- `JWT_PLATFORM_SECRET` — a random string of at least 32 characters. **No default; the server will refuse to start without it.**
- `ADMIN_PASSWORD` — the password for the bootstrap admin account. **No default.**
- `POSTGRES_*` — update host, port, database, user, and password to match your PostgreSQL instance.

Full reference:

| Variable | Required | Description | Example |
|---|---|---|---|
| `POSTGRES_HOST` | Yes | PostgreSQL host | `localhost` |
| `POSTGRES_PORT` | Yes | PostgreSQL port | `5432` |
| `POSTGRES_DB` | Yes | Platform database name | `toph` |
| `POSTGRES_USER` | Yes | PostgreSQL user | `postgres` |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password | `postgres` |
| `JWT_PLATFORM_SECRET` | **Required** | Secret for signing platform JWTs. Must be at least 32 characters. No default. | `a-long-random-secret-string-here` |
| `ACCESS_TOKEN_EXPIRY` | No | Access token TTL in seconds | `3600` |
| `REFRESH_TOKEN_EXPIRY` | No | Refresh token TTL in seconds | `604800` |
| `ADMIN_EMAIL` | No | Bootstrap admin email | `admin@toph.local` |
| `ADMIN_PASSWORD` | **Required** | Bootstrap admin password. No default. | `changeme` |
| `GATEWAY_PORT` | No | Port the API listens on | `8000` |
| `GATEWAY_HOST` | No | Host the API binds to | `0.0.0.0` |
| `LOG_LEVEL` | No | Pino log level | `info` |
| `CORS_ALLOWED_ORIGINS` | No | Comma-separated list of allowed CORS origins | `http://localhost:3000` |
| `RATE_LIMIT_AUTH` | No | Max auth requests per minute | `5` |
| `RATE_LIMIT_API` | No | Max API requests per minute | `100` |
| `ENABLE_SIGNUP` | No | Allow new platform user sign-ups | `true` |
| `REQUIRE_AUTH_FOR_API` | No | Require authentication on REST API endpoints | `true` |
| `PUBLIC_API_URL` | No | Base domain for project-specific API URLs. Requires wildcard DNS in production. | `http://localhost:8000` |

**3. Initialize the database**

**Option A — Docker (recommended)**

Starts PostgreSQL and applies the platform schema automatically:

```bash
docker compose up -d
```

**Option B — Local PostgreSQL**

```bash
createdb toph
psql -U postgres -d toph -f migrations/schema.sql
```

**4. Install dependencies**

```bash
make install
```

**5. Start both apps**

```bash
make dev
```

- Dashboard: http://localhost:3000
- API: http://localhost:8000

Log in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you configured.

---

## Make Targets

### Root targets

| Target | Description |
|---|---|
| `make install` | Install dependencies for both apps |
| `make dev` | Start both API and dashboard in parallel |
| `make build` | Build both apps for production |
| `make test` | Run the API test suite |
| `make clean` | Remove build artifacts from both apps |

### Per-app targets

| Target | Description |
|---|---|
| `make api/dev` | Start the API only |
| `make api/build` | Build the API only |
| `make api/test` | Run API tests only |
| `make api/clean` | Clean API build artifacts |
| `make dashboard/dev` | Start the dashboard only |
| `make dashboard/build` | Build the dashboard only |
| `make dashboard/clean` | Clean dashboard build artifacts |

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
| All standard pg extensions (`pgcrypto`, `pgvector`, `pg_trgm`, `citext`, `uuid-ossp`, `hstore`, `ltree`, `unaccent`, `pg_hashids`, `pg_uuidv7`, `pgtap`, `age`, `pg_ivm`, etc.) | ✅ Identical | 40+ extensions available |
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
| Realtime | ❌ Not implemented | |
| Edge Functions | ❌ Not implemented | |

`CREATE EXTENSION IF NOT EXISTS` for unsupported extensions is stripped by the migration runner — migrations always apply cleanly.

---

## License

See [LICENSE](LICENSE) file.
