# Contributing

Thanks for your interest in contributing to toph-base.

## Setup

**Prerequisites:** Node.js >= 20, pnpm 10, [dotenvx](https://dotenvx.com)

```bash
git clone https://github.com/avocadocutter/toph-base.git
cd toph-base
pnpm install
```

Copy the example secrets file and fill in the required values:

```bash
cp apps/api/.env.example ~/.secrets/toph-base.env
# Set JWT_PLATFORM_SECRET and ADMIN_PASSWORD at minimum
```

Start the dev environment:

```bash
pnpm dev
```

- API: http://localhost:8000
- Dashboard: http://localhost:3000

## Project structure

```
apps/api/          Fastify API — auth, REST, storage, RLS, PGlite
apps/dashboard/    React 19 + Vite admin SPA
apps/orchestrator/ tophbase CLI (freshman / graduate / schema)
migrations/        Platform SQL schema
scripts/           Build utilities
```

## Making changes

- **API changes** — `apps/api/src/`. Run `pnpm --filter @tophbase/api test` after changes.
- **Dashboard changes** — `apps/dashboard/src/`. The Vite dev server hot-reloads automatically.
- **CLI changes** — `apps/orchestrator/src/`. Test with `tsx src/cli/tophbase.ts freshman` from the orchestrator directory.

## Before submitting a PR

```bash
pnpm build                              # full build passes
pnpm --filter @tophbase/api test        # tests pass
pnpm --filter @tophbase/api lint        # no lint errors
pnpm --filter @tophbase/dashboard lint  # no lint errors
```

Update `CHANGELOG.md` under `[Unreleased]` with a short description of your change.

## Reporting bugs

Use the [bug report template](https://github.com/avocadocutter/toph-base/issues/new?template=bug_report.yml).

## Security issues

Do not open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md).
