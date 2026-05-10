# toph-base

A self-hosted database platform with REST API, auth, and a web dashboard.

Inspired by Supabase, toph-base gives you multi-tenant PostgreSQL projects, JWT authentication, row-level security, and a PostgREST-compatible REST API — all running on your own infrastructure.

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

- **apps/api** — the API gateway. Handles multi-tenant PostgreSQL connection pooling, JWT-based platform auth, per-project RLS enforcement, and a PostgREST-compatible REST API. Bootstraps an admin user on first boot. Serves the dashboard as static files in production.
- **apps/dashboard** — the admin SPA. Lets you create and manage projects, run SQL queries, manage API keys, and apply migrations from a browser UI.
- **migrations/** — SQL files that initialize and evolve the `toph_internal` platform schema (users, projects, API keys, etc.). Applied manually with `psql`.

---

## Prerequisites

- Node.js >= 20
- pnpm 10 (`npm install -g pnpm@10`)
- PostgreSQL 13+ (local install or any accessible instance)

---

## Quick Start

**1. Clone the repo**

```bash
git clone <repo-url>
cd toph-base
```

**2. Configure the API**

```bash
cp apps/api/.env.example apps/api/.env
```

Open `apps/api/.env` and set at minimum:

- `JWT_PLATFORM_SECRET` — a random string of at least 32 characters. **No default; the server will refuse to start without it.**
- `ADMIN_PASSWORD` — the password for the bootstrap admin account. **No default.**
- `POSTGRES_*` — update host, port, database, user, and password to match your PostgreSQL instance.

**3. Initialize the database**

Create the database and run the platform migrations:

```bash
# Create the database (if it doesn't exist)
createdb toph

# Apply the platform schema
psql -d toph -f migrations/init.sql
psql -d toph -f migrations/002_api_keys.sql
psql -d toph -f migrations/003_remove_legacy_keys.sql
psql -d toph -f migrations/005_project_migrations.sql
psql -d toph -f migrations/006_fix_migrations_unique_constraint.sql
psql -d toph -f migrations/007_database_per_project.sql
psql -d toph -f migrations/008_toph_superuser.sql
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

## Environment Variables

All variables are read from `apps/api/.env`. The API uses Node.js's native `--env-file` flag.

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
| `POSTGREST_HEALTH_CHECK_INTERVAL_MS` | No | Interval between PostgREST health checks | `30000` |
| `POSTGREST_HEALTH_CHECK_TIMEOUT_MS` | No | Timeout for PostgREST health checks | `5000` |
| `PUBLIC_API_URL` | No | Base domain for project-specific API URLs. Requires wildcard DNS in production. | `http://localhost:8000` |

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

See [LICENSE](LICENSE) file.
