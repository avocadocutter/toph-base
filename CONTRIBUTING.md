# Contributing

## Development setup

**Prerequisites**

- Node.js 20+
- pnpm 10
- PostgreSQL 13+ (local install) or Docker

**Steps**

1. Clone the repository.

2. Copy the API environment file and fill in any values you need to change:
   ```
   cp apps/api/.env.example ~/.secrets/toph-base.env
   ```

3. (Optional) Start PostgreSQL with Docker:
   ```
   docker compose up -d
   ```

4. Install dependencies:
   ```
   make install
   ```

5. Run database migrations:
   ```
   make api/migrate
   ```

6. Start the development servers (API + dashboard run concurrently):
   ```
   make dev
   ```

## Project structure

| Path | Description |
|---|---|
| `apps/api` | Node.js/TypeScript backend — authentication, REST proxy, project management |
| `apps/dashboard` | React frontend served on `localhost:3000` |
| `migrations` | Platform-level SQL migrations applied at startup |

## Running tests

```
make test
```

Or run the API tests directly:

```
cd apps/api && pnpm test
```

## Code style

The project uses ESLint and Prettier.

```
# Lint
cd apps/api && pnpm lint
cd apps/dashboard && pnpm lint

# Format
cd apps/api && pnpm format
cd apps/dashboard && pnpm format
```

CI enforces both lint and formatting checks on every pull request.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
type(scope): description
```

Accepted types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

Examples:
```
feat(api): add rate limiting per project
fix(dashboard): correct project switcher redirect
```

## Branch naming

```
feat/short-description
fix/short-description
```

## Pull request process

1. Fork the repository and create a branch from `main`.
2. Make your changes and ensure tests pass (`make test`).
3. Open a pull request against `main`.
4. Describe what changed and why in the PR body.
5. CI must pass before the PR can be merged.

## Known limitations

The built-in REST API has the following incomplete features:

- No logical OR filters — only AND-chained conditions are supported
- No NOT modifier for filter operators
- No relationship embedding or implicit JOINs across tables
- No full-text search operators (`fts`, `plfts`, `phfts`, `wfts`)
- No HEAD request support for count-only queries
