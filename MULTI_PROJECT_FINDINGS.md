# Multi-Project Readiness Analysis: Findings & Consensus

> Two independent analysts (Agent A: Database Architect, Agent B: Security & API Architect) examined the toph-base codebase and debated multi-project isolation strategies. This document captures the consensus, noted dissents, and prioritized action items.

---

## Verdict: Current State

**toph-base is a single-project, single-tenant system.** Every layer — database init, connection pool, schema introspection, REST API generation, RLS context, JWT signing, admin operations — assumes one project, one database, one `public` schema, one JWT secret. There is no concept of "project" anywhere in the codebase.

---

## The Debate: Schema-Per-Project vs Database-Per-Project

### Agent A argued: Schema-per-project (one PG schema per project, same database)

- Codebase is "70% there" — `introspectSchema()` already accepts `schemaName`, `query-builder.ts` generates qualified `"schema"."table"` names, RLS routes accept `:schema` param
- Single connection pool works — no pool-per-project overhead
- ~30 call sites need changes vs a full connection lifecycle rewrite
- Operational simplicity for self-hosted deployments (backup, monitoring, connection limits)
- Adequate for single-operator, self-hosted use case

### Agent B argued: Database-per-project (separate PG database per project)

- **Fails closed** — a bug produces "table not found" errors, not silent cross-tenant data leaks
- `search_path` is not a security boundary — it's a convenience GUC that SQL can override
- Shared `service_role` with `BYPASSRLS` means one compromised credential exposes all projects
- Admin SQL endpoint (`POST /admin/sql`) can trivially `SET search_path TO other_project`
- Structural control-plane / data-plane separation — `toph_internal` can't be accidentally modified from project SQL
- Existing role system (`anon`/`authenticated`/`service_role`) works unchanged per-database

### Where they agreed

| Point | Consensus |
|-------|-----------|
| Per-project JWT secrets | **Essential** regardless of isolation model |
| Two-tier user model | Platform users (manage projects) vs project users (end-users) |
| `projects` + `project_members` tables | Required in `toph_internal` |
| Per-project API keys (anon + service_role) | Required, matching Supabase's model |
| Introspection cache must become per-project | Singleton `cache` in `inspector.ts` is untenable |
| Auth bifurcation | Platform auth (dashboard) vs project auth (API consumers) |
| SQL injection bugs are urgent | Must fix regardless of isolation strategy |
| Instance-per-project is out of scope | Too much infra for the current stage |

### Where they disagreed

| Point | Agent A | Agent B |
|-------|---------|---------|
| Isolation model | Schema-per-project first, migrate later | Database-per-project from day one |
| "70% there" claim | True — most infra is schema-parameterized | Misleading — the missing 30% IS the security layer |
| Shared roles | Mitigable with per-project role triads | Full authz rewrite either way; DB isolation avoids it |
| search_path as isolation | Primary mechanism + JWT secrets | Not a security boundary, can be overridden |
| Connection overhead | 20 conns/pool × N projects is unsustainable | Manageable with lazy pools + PgBouncer |
| Migration path | Schema → database later if needed | Schema creates debt that makes migration harder |
| Failure mode | Schema boundaries + defense-in-depth | Only DB boundaries fail closed |

### Consensus recommendation

**Database-per-project is the correct long-term architecture**, but the implementation path depends on ambition:

- **If toph-base will ever serve multiple operators/organizations**: Start with database-per-project. The `fastify.db` refactor is mechanical (TypeScript catches every call site), and the security model fails closed by default. Use lazy pools with eviction + PgBouncer for connection management.

- **If toph-base remains strictly single-operator, self-hosted**: Schema-per-project is acceptable as v1, provided per-project JWT secrets, per-project roles, and proper `search_path` isolation are all implemented atomically (not incrementally). **Do not ship partial isolation.**

Both agents agreed: **the incremental path is dangerous**. All isolation mechanisms must land together or you have a cross-tenant vulnerability window.

---

## Critical Security Findings (Fix Regardless of Multi-Project)

### HIGH: SQL Injection in DDL Operations

**Column type interpolation** — `admin/index.ts:67`
```typescript
let def = `${quoteIdentifier(col.name)} ${col.type}`;
// col.type is z.string().min(1) — any string passes
```
Column names are properly quoted, but `col.type` is interpolated raw. An admin could submit `"type": "text); DROP TABLE users; --"`.

**Default value interpolation** — `admin/index.ts:70`
```typescript
if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
```
`defaultValue` is an unvalidated string interpolated into DDL.

**RLS policy expressions** — `rls/index.ts:126-131`
```typescript
if (body.using) sql += ` USING (${body.using})`;
if (body.withCheck) sql += ` WITH CHECK (${body.withCheck})`;
```
`body.using` and `body.withCheck` are user-provided SQL interpolated into `CREATE POLICY`.

**Fix**: Allowlist column types against `pg_type`. Sanitize/parameterize default values. Consider sandboxing policy expressions. Note: `node-postgres` only executes single statements per `query()` call, which limits but does not eliminate injection risk.

### HIGH: Default Credentials in Source Code — `config.ts`

```
postgres password:  'changeme'
JWT secret:         'change-this-to-a-random-string-at-least-32-chars'
admin email:        'admin@toph.local'
admin password:     'changeme'
```
Anyone who reads the source can forge JWTs for unpatched deployments. Remove defaults for security-sensitive values; fail to start if not set.

### MEDIUM: Weak Input Validation

- `refreshHandler` (`handlers.ts:139`) — refresh token body cast with `as`, not validated with Zod. Non-string values produce predictable hashes.
- Admin user update/delete (`admin/index.ts:188-231`) — `id` param not validated as UUID.
- Settings update (`admin/index.ts:244-255`) — body is `Record<string, unknown>` with no validation.
- Extension enable (`admin/index.ts:304-308`) — no dangerous extension blocklist (`dblink`, `adminpack`, etc.).

### MEDIUM: Auth Edge Cases

- `authenticateOptional` (`authenticate.ts:22-37`) silently downgrades invalid/expired tokens to anonymous instead of returning errors.
- `/auth/signout` has no `preHandler` — anyone with a refresh token can invalidate sessions without a valid access token.
- `login_attempts` table created but never written to — rate limits are purely in-memory, reset on restart.

### LOW: Missing Hardening

- CSP disabled (`index.ts:53`): `contentSecurityPolicy: false`
- No CSRF token mechanism (relies solely on CORS)
- No audit logging on admin operations (SQL execution, user modifications, table drops)
- `SET LOCAL ROLE` in `rls-context.ts:21` uses string interpolation (safe today since values are hardcoded, but fragile if extended)

---

## What Needs to Be Built for Multi-Project

### New Database Objects

```sql
-- Control plane: project registry
CREATE TABLE toph_internal.projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref         TEXT UNIQUE NOT NULL,  -- short slug, e.g. 'abcdefgh'
    name        TEXT NOT NULL,
    owner_id    UUID NOT NULL REFERENCES toph_internal.users(id),
    jwt_secret  TEXT NOT NULL,         -- per-project signing key
    anon_key    TEXT NOT NULL,          -- pre-signed JWT with role=anon
    service_key TEXT NOT NULL,          -- pre-signed JWT with role=service_role
    db_name     TEXT NOT NULL UNIQUE,   -- PG database name (db-per-project)
    status      TEXT NOT NULL DEFAULT 'active',
    settings    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Control plane: project membership / RBAC
CREATE TABLE toph_internal.project_members (
    project_id  UUID NOT NULL REFERENCES toph_internal.projects(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES toph_internal.users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

-- Control plane: API key registry
CREATE TABLE toph_internal.api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES toph_internal.projects(id) ON DELETE CASCADE,
    key_hash    TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('anon', 'service_role')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### New Application-Layer Concepts

| Concept | Description |
|---------|-------------|
| **Project provisioning** | Create PG database, run init template (roles, auth tables, helper functions, event triggers), generate JWT secret + API keys |
| **Pool registry** | `Map<projectId, pg.Pool>` with lazy creation and idle eviction. Replace `fastify.db` singleton for project queries; keep management pool for `toph_internal` |
| **Project resolver middleware** | Extract project from URL path (`/projects/:ref/...`) or `apikey` header. Validate key, decorate request with `projectId`, `projectSchema`, `projectDb` |
| **Per-project JWT** | `jwt.ts` refactored to accept secret key param instead of module-level singleton. Token claims include `project_id` |
| **Bifurcated auth** | Platform auth → `toph_internal.users` + management pool. Project auth → per-project `auth_users` + project pool |
| **Project-scoped admin** | `requireProjectAdmin` hook checks `project_members` RBAC. SQL endpoint scoped to project DB |
| **Per-project introspection cache** | `Map<projectId, SchemaCache>` with project-scoped DDL notifications |

### RBAC Model

| Role | Scope | Capabilities |
|------|-------|-------------|
| Platform Super Admin | Global | Create/delete projects, manage platform users, view all |
| Project Owner | Single project | Full control: tables, RLS, users, SQL, settings, keys |
| Project Admin | Single project | Manage tables, users, RLS; no delete project |
| Project Member | Single project | View-only dashboard access |

### API Routing (Recommended)

```
# Project API (end-users of apps built on toph)
POST /projects/:ref/rest/v1/:table
POST /projects/:ref/auth/signup
     Headers: apikey: <anon-key>, Authorization: Bearer <user-jwt>

# Platform API (toph administrators)
POST /auth/signin                    (platform login)
GET  /admin/projects                 (list projects)
POST /admin/projects                 (create project)
GET  /projects/:ref/admin/tables     (project-scoped admin)
POST /projects/:ref/admin/sql        (project-scoped SQL)
```

---

## Recommended Implementation Order

| Phase | Work | Priority |
|-------|------|----------|
| **0. Security fixes** | Fix SQL injection in DDL (column types, defaults, policy expressions). Remove default credentials. Add Zod validation to unvalidated endpoints. | **Do first** |
| **1. Project foundation** | `projects` + `project_members` + `api_keys` tables. Project CRUD API. | High |
| **2. Pool registry** | Replace `fastify.db` singleton with management pool + lazy project pool registry. | High |
| **3. Project provisioning** | Database creation, init template, JWT secret generation, API key generation. | High |
| **4. Auth bifurcation** | Split platform auth from project auth. Per-project JWT secrets. | High |
| **5. Project resolver** | Middleware that maps `apikey` header / URL param to project context. | High |
| **6. Scoped introspection** | Per-project cache with project-scoped DDL invalidation. | Medium |
| **7. Dashboard updates** | Project selector/switcher. Project-scoped admin views. | Medium |
| **8. Hardening** | Audit logging. CSP. Extension allowlist. Rate limit persistence. | Medium |

---

## Files That Need Changes

| File | Change | Effort |
|------|--------|--------|
| `docker/init.sql` | Add `projects`, `project_members`, `api_keys` tables. Modify DDL trigger to include schema/db info. | Medium |
| `src/config.ts` | Remove defaults for secrets/passwords. Add pool config options. | Low |
| `src/db/pool.ts` | Add pool registry class alongside management pool. | Medium |
| `src/index.ts` | Project resolver middleware. Bifurcate bootstrap. | Medium |
| `src/plugins/introspection/inspector.ts` | Per-project cache map. Scoped invalidation. | Medium |
| `src/plugins/rest-api/index.ts` | Extract project from request. Use project pool. | Medium |
| `src/plugins/rest-api/rls-context.ts` | Accept project-specific pool. (Schema model: also set search_path) | Low |
| `src/plugins/rest-api/query-builder.ts` | No change needed — already uses qualified identifiers. | None |
| `src/plugins/rls/index.ts` | Use project pool. Already schema-parameterized. | Low |
| `src/plugins/admin/index.ts` | New project CRUD routes. Scope all ops to project. Fix SQL injection. | High |
| `src/plugins/auth/handlers.ts` | Bifurcate platform vs project auth. Per-project user tables. | High |
| `src/plugins/auth/jwt.ts` | Parameterize secret key (remove module singleton). Add `project_id` claim. | Medium |
| `src/hooks/authenticate.ts` | Project-aware JWT verification. Populate `request.projectId`. | Medium |
| `src/types/fastify.d.ts` | Add `projectId`, `projectDb`, `dbRegistry` declarations. | Low |
| **New: `src/plugins/projects/`** | Project CRUD, provisioning, membership, API key management. | High |
