# Built-in REST API (PostgREST-compatible)

This plugin provides a PostgREST-compatible REST API that runs **inside the toph-base gateway process** — no external PostgREST binary required. It speaks the same HTTP protocol that the Supabase JS client uses, so existing apps work without modification for common operations.

---

## Architecture

```
plugins/rest-api/
├── index.ts          ← Fastify plugin + route registration
├── query-parser.ts   ← Parses PostgREST-style query params → structured query object
├── query-builder.ts  ← Builds parameterized SQL from structured query object
├── rls-context.ts    ← Executes SQL inside a transaction with SET LOCAL ROLE + JWT claims
└── README.md         ← This file
```

### Data flow

```
HTTP request
  │
  ├─ preHandler: resolveFromApikey (or resolveProject + authHook)
  │    Sets request.project, request.projectDb, request.jwtPayload
  │
  └─ Route handler
       │
       ├─ introspectSchema()      Query information_schema (60s cache)
       ├─ parseQueryParams()      ?select=a,b&status=eq.active → ParsedQuery
       ├─ buildSelectQuery()      ParsedQuery → { text, values }
       └─ executeWithRlsContext() BEGIN → SET LOCAL ROLE → set_config claims → query → COMMIT
```

### Isolation design

The plugin accepts all auth/project-resolution logic via **dependency injection** — it imports nothing from the hooks or auth layers. This means you can:

- Swap out the auth mechanism without touching this plugin.
- Replace the entire plugin without touching auth code.
- Test the plugin in isolation by injecting stub hooks.

The hooks are passed at registration time in `index.ts`:

```typescript
await fastify.register(restApiPlugin, {
  resolveFromApikey: createApikeyResolver(db, poolManager),
  resolveProject:    createProjectResolver(db, poolManager),
  authHook:          config.features.requireAuthForApi
                       ? authenticateProject
                       : authenticateProjectOptional,
});
```

---

## Route families

### 1. Supabase-compatible routes (`/rest/v1/:table`)

These are what the Supabase JS client calls. Project and auth are resolved from the `apikey` request header. When accessed via subdomain routing (`{project-ref}.host/rest/v1/{table}`), the `apikey` header identifies the project.

```
GET    /rest/v1/:table
POST   /rest/v1/:table
PATCH  /rest/v1/:table
DELETE /rest/v1/:table
```

### 2. Project-scoped routes (`/project/:projectRef/rest/v1/:table`)

Same handlers, different auth chain. Project is resolved from the URL param; auth via Bearer JWT. Useful for server-side access and admin tooling where you hold a platform/project JWT rather than an API key.

```
GET    /project/:projectRef/rest/v1/:table
POST   /project/:projectRef/rest/v1/:table
PATCH  /project/:projectRef/rest/v1/:table
DELETE /project/:projectRef/rest/v1/:table
```

---

## Supported features

### Column selection
```
GET /rest/v1/posts?select=id,title,created_at
```

### Filtering (AND only)
| Operator | Syntax          | SQL equivalent        |
|----------|-----------------|-----------------------|
| `eq`     | `col=eq.value`  | `col = 'value'`       |
| `neq`    | `col=neq.value` | `col != 'value'`      |
| `gt`     | `col=gt.value`  | `col > 'value'`       |
| `gte`    | `col=gte.value` | `col >= 'value'`      |
| `lt`     | `col=lt.value`  | `col < 'value'`       |
| `lte`    | `col=lte.value` | `col <= 'value'`      |
| `like`   | `col=like.val%` | `col LIKE 'val%'`     |
| `ilike`  | `col=ilike.V%`  | `col ILIKE 'V%'`      |
| `is`     | `col=is.null`   | `col IS NULL`         |
| `in`     | `col=in.(a,b)`  | `col IN ('a','b')`    |

### Ordering and pagination
```
GET /rest/v1/posts?order=created_at.desc&limit=20&offset=40
```

### Count
```
GET /rest/v1/posts?select=*
Prefer: count=exact
→ Response header: Content-Range: 0-19/847
```

### Insert (single or bulk)
```
POST /rest/v1/posts
Content-Type: application/json
Prefer: return=representation

{ "title": "Hello" }
// or an array: [{ "title": "A" }, { "title": "B" }]
```

### Upsert
```
POST /rest/v1/posts
Prefer: resolution=merge-duplicates,return=representation

{ "id": "existing-id", "title": "Updated" }
```
Uses `ON CONFLICT (primary_key) DO UPDATE SET ...`. Use `resolution=ignore-duplicates` for `DO NOTHING` behaviour.

When the conflict target is a unique constraint on non-primary-key columns, pass the column names via `?on_conflict=`:
```
POST /rest/v1/user_enrollments?on_conflict=user_id,course_slug
Prefer: resolution=merge-duplicates,return=representation
```

### Update
```
PATCH /rest/v1/posts?id=eq.abc123
Content-Type: application/json
Prefer: return=representation

{ "title": "New title" }
```
At least one filter is required to prevent accidental full-table updates.

### Delete
```
DELETE /rest/v1/posts?id=eq.abc123
Prefer: return=representation
```
At least one filter is required.

### `Prefer` header values

| Value                            | Effect                                       |
|----------------------------------|----------------------------------------------|
| `return=representation`          | Return affected rows in response body        |
| `return=minimal`                 | Return 204 with empty body                   |
| `count=exact`                    | Run COUNT query, add total to Content-Range  |
| `count=planned`                  | Alias for exact (planned is not approximated)|
| `resolution=merge-duplicates`    | Upsert: DO UPDATE SET                        |
| `resolution=ignore-duplicates`   | Upsert: DO NOTHING                           |

### RLS (Row Level Security)
RLS is enforced on every query:
- `SET LOCAL ROLE anon` for unauthenticated requests
- `SET LOCAL ROLE authenticated` for requests with a valid user JWT
- `SET LOCAL ROLE service_role` for secret-key requests
- `request.jwt.claims`, `request.jwt.claim.sub`, `request.jwt.claim.role`,
  and `request.jwt.claim.email` are all set in the transaction, so
  `auth.uid()`, `auth.role()`, and `auth.email()` PostgreSQL helper functions work.

---

## Unsupported features (gaps)

These are PostgREST features not yet implemented. PRs welcome — each gap is isolated to `query-parser.ts` or `query-builder.ts` and does not require changes to any other file.

### Logical OR filters
```
# Not supported:
GET /rest/v1/posts?or=(status.eq.active,status.eq.draft)
```
To implement: add `or` parsing in `parseQueryParams()` and a `buildOrClause()` in `query-builder.ts`.

### NOT modifier
```
# Not supported:
GET /rest/v1/posts?status=not.eq.deleted
```
To implement: detect the `not.` prefix in `parseQueryParams()` and emit `col != $n` / `col NOT IN (...)` etc.

### Relationship embedding (joins)
```
# Not supported:
GET /rest/v1/posts?select=id,title,comments(*)
```
PostgREST auto-generates JOINs from foreign keys. To implement: extend `query-builder.ts` to detect `table(columns)` syntax in `select`, look up foreign keys from `TableInfo.foreignKeys`, and emit the appropriate JOIN. Schema introspection already fetches foreign key info.

### Full-text search operators
```
# Not supported:
GET /rest/v1/posts?body=fts.postgresql
GET /rest/v1/posts?body=plfts.search+terms
```
To implement: add `fts`, `plfts`, `phfts`, `wfts` operators to `VALID_OPERATORS` in `query-parser.ts` and handle them in `buildWhereClause()`.

### Array/range operators
```
# Not supported:
GET /rest/v1/posts?tags=cs.{typescript,postgres}   (contains)
GET /rest/v1/posts?tags=cd.{a,b}                   (contained by)
GET /rest/v1/posts?range_col=adj.{1,5}             (adjacent)
GET /rest/v1/posts?range_col=ov.{1,5}              (overlap)
```

### HEAD requests (count-only)
```
# Not supported:
HEAD /rest/v1/posts
Prefer: count=exact
```

### OpenAPI spec endpoint
```
# Not supported:
GET /rest/v1/
```
PostgREST returns an OpenAPI spec here. Could be generated from schema introspection.

### Stored procedure calls (RPC)
```
# Not supported:
POST /rest/v1/rpc/my_function
{ "param": "value" }
```

### `on_conflict` with non-unique constraint columns
The `?on_conflict=col1,col2` param is supported and targets the specified columns in `ON CONFLICT (...)`. What is **not** supported is PostgREST's ability to target a named constraint directly (e.g. `?on_conflict=constraint_name`). Column names only.

---

## Error format

Our errors use toph-base's internal format, which differs from PostgREST:

```json
// toph-base (this implementation)
{ "error": { "code": "NOT_FOUND", "message": "Table 'xyz' not found" } }

// PostgREST
{ "code": "42P01", "details": null, "hint": null, "message": "relation \"xyz\" does not exist" }
```

The Supabase JS client wraps both into its own `PostgrestError` object. Functional behaviour is the same; error messages differ. This is acceptable for application use — it only matters when inspecting raw error objects in tests or logs.

---

## Adding a new filter operator

1. Add the operator string to `VALID_OPERATORS` in `query-parser.ts`.
2. Add a case for it in the `switch` inside `buildWhereClause()` in `query-builder.ts`.
3. No other files need to change.

## Adding relationship embedding

1. Extend `parseQueryParams()` in `query-parser.ts` to detect `table(cols)` syntax in the `select` param and populate a new `relations` field on `ParsedQuery`.
2. Extend `buildSelectQuery()` in `query-builder.ts` to emit LEFT JOINs using `TableInfo.foreignKeys`.
3. No other files need to change.

## Replacing the SQL execution layer

The entire RLS + transaction logic lives in `rls-context.ts`. To replace it (e.g., with a different transaction strategy or a different claims format), implement a function with the same signature as `executeWithRlsContext` and swap the import in `index.ts`.

## Replacing this plugin entirely

Since auth is injected, you can replace the entire REST API plugin by:
1. Writing a new Fastify plugin that accepts `RestApiPluginOptions` (re-export the type from `index.ts`)
2. Swapping the import in the main `index.ts`

The rest of the codebase — auth, project resolution, pool management — is untouched.
