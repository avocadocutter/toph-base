# AGENTS.md

> **Note:** `CLAUDE.md` is a symlink to this file. They are the same file.

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini, etc.) working in this repo.

## What this repo is

A self-hosted database platform with REST API, authentication, and a web dashboard. Inspired by Supabase. Built and maintained by one person.

Two apps, one repo:
- `apps/api` — Fastify 5 + TypeScript API gateway (auth, multi-tenant PostgreSQL pooling, Supabase-compatible REST API)
- `apps/dashboard` — React 19 + Vite + TailwindCSS admin SPA

## Commands

```sh
make install          # install dependencies for both apps
make dev              # start both apps in parallel (API :8000, dashboard :3000)
make build            # build both apps for production
make test             # run the API test suite (vitest)
make api/dev          # API only
make dashboard/dev    # dashboard only
```

The API requires secrets loaded via `dotenvx` from `~/.secrets/toph-base.env`. See `apps/api/.env.example` for all required variables.

## Project structure

```
apps/api/src/
  index.ts            # server bootstrap, plugin registration
  config.ts           # env var validation — all required vars fail fast here
  db/
    pool.ts           # pg Pool wrapper
    pool-manager.ts   # per-project connection pool lifecycle
  hooks/              # Fastify request lifecycle hooks (auth, project resolution)
  lib/                # pure utilities (errors, SQL helpers, types)
  plugins/
    auth/             # platform login, signup, token refresh, project JWTs
    api-keys/         # publishable + secret key management
    projects/         # project CRUD
    rest-api/         # Supabase-compatible REST layer (query parser, builder, RLS)
    introspection/    # schema inspector for the REST layer
    rls/              # row-level security context injection
    admin/            # admin-only routes (migrations, SQL upload)

apps/dashboard/src/
  # React SPA — pages map to dashboard sections (projects, SQL editor, API keys)
```

## Code style

- TypeScript strict mode. No `any` without a comment explaining why.
- Zod for all external input validation (request bodies, env vars).
- Fastify plugin pattern — every feature is an `async function plugin(fastify, opts)` registered with `fastify.register()`.
- `lib/errors.ts` defines all error types — use them, don't throw raw `Error`.
- No fallback defaults for required env vars. `config.ts` throws on startup if anything is missing.
- ESLint + Prettier enforced in CI. Run `make api/lint` before opening a PR.

## Boundaries

- Don't modify `apps/api/src/db/pool-manager.ts` without understanding the full connection lifecycle — it manages per-project pg pools and is easy to leak connections in.
- Don't add `console.log` — use the Fastify logger (`request.log`, `fastify.log`).
- Don't change the migrations in `migrations/` without adding a new numbered file — never edit existing migration files.
- Don't add root-level dependencies to fix a single app's need — add to that app's `package.json`.
- Don't write `.md` files unless explicitly asked.
- Don't create commits unless explicitly asked.

## Testing

Tests live in `apps/api/src/**/*.test.ts` and run with `vitest`. No tests exist yet — the infrastructure is in place but coverage is zero.

When writing tests: start a real Fastify instance against a real PostgreSQL database. Connection details from the `env:` block in `.github/workflows/ci.yml`. Don't mock the database.

## Security-sensitive areas

These files touch auth, keys, or RLS — be careful and conservative here:

- `apps/api/src/plugins/auth/jwt.ts` — token signing and verification
- `apps/api/src/plugins/auth/password.ts` — Argon2id hashing
- `apps/api/src/plugins/api-keys/index.ts` — key generation and validation
- `apps/api/src/plugins/rest-api/rls-context.ts` — per-request RLS injection
- `apps/api/src/hooks/authenticate.ts` — request authentication hook
