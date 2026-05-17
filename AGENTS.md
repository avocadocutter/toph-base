# AGENTS.md

> **Note:** `CLAUDE.md` is a symlink to this file. They are the same file.

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini, etc.) working in this repo.

## What this repo is

Vibebase — a zero-config local BaaS (Backend-as-a-Service) for AI-generated apps. Run `npx vibebase start`, pick your SDK dialect in the onboarding UI, and your AI-generated Supabase/PocketBase/Appwrite code works against localhost with no Docker, no account, no setup.

Two apps, one repo:
- `apps/api` — Fastify 5 + TypeScript + PGLite (embedded WASM PostgreSQL). Serves the Supabase-compatible REST + auth API.
- `apps/dashboard` — React 19 + Vite + TailwindCSS. Studio UI + first-run onboarding dialect picker.

## Commands

```sh
# Install dependencies
cd apps/api && pnpm install
cd apps/dashboard && pnpm install

# Development (run both in separate terminals)
cd apps/api && pnpm dev        # API on :8000
cd apps/dashboard && pnpm dev  # Dashboard on :3000

# Or start as a user would
cd apps/api && pnpm tsx src/cli/vibebase.ts start

# Tests (API only, vitest)
cd apps/api && pnpm test

# Build
cd apps/api && pnpm build
cd apps/dashboard && pnpm build
```

No Make, no Docker, no PostgreSQL server required. PGLite runs in-process.

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

Tests live in `apps/api/src/**/*.test.ts` and run with `vitest`.

When writing tests: start a real Fastify instance. Mock the database and any external dependencies — pass stub implementations via Fastify decorators or plugin options rather than connecting to a real PostgreSQL instance.

## Security-sensitive areas

These files touch auth, keys, or RLS — be careful and conservative here:

- `apps/api/src/plugins/auth/jwt.ts` — token signing and verification
- `apps/api/src/plugins/auth/password.ts` — Argon2id hashing
- `apps/api/src/plugins/api-keys/index.ts` — key generation and validation
- `apps/api/src/plugins/rest-api/rls-context.ts` — per-request RLS injection
- `apps/api/src/hooks/authenticate.ts` — request authentication hook

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
