import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { introspectSchema } from '../introspection/inspector.js';
import { parseQueryParams } from './query-parser.js';
import {
  buildSelectQuery,
  buildCountQuery,
  buildInsertQuery,
  buildUpsertQuery,
  buildUpdateQuery,
  buildDeleteQuery,
} from './query-builder.js';
import { executeWithRlsContext } from './rls-context.js';
import { NotFoundError, BadRequestError, AppError } from '../../lib/errors.js';
import { quoteIdentifier } from '../../lib/sql-helpers.js';

// ── Public plugin contract ────────────────────────────────────────────────────

/**
 * Hook signature shared by all pre-handler hooks in this plugin.
 * Each hook must populate `request.project` and `request.projectDb` before
 * the route handler runs. It may also populate `request.jwtPayload` for RLS.
 */
export type RestHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Dependency-injected options for the REST API plugin.
 *
 * All auth/project-resolution logic lives OUTSIDE this plugin.
 * Pass in hooks built from the rest of the codebase so that this
 * plugin can be changed or replaced without touching auth code.
 *
 * @example
 * await fastify.register(restApiPlugin, {
 *   resolveFromApikey: createApikeyResolver(db, poolManager),
 *   resolveProject:    createProjectResolver(db, poolManager),
 *   authHook:          config.features.requireAuthForApi
 *                        ? authenticateProject
 *                        : authenticateProjectOptional,
 * });
 */
export interface RestApiPluginOptions {
  /**
   * Resolves project + auth from the `apikey` request header.
   * Used by Supabase-compatible routes (`/rest/v1/:table`).
   * Must set `request.project`, `request.projectDb`, and `request.jwtPayload`.
   */
  resolveFromApikey: RestHook;

  /**
   * Resolves project from URL params (`/project/:projectRef/...`) or
   * the request subdomain. Used by project-scoped admin routes.
   * Must set `request.project` and `request.projectDb`.
   */
  resolveProject: RestHook;

  /**
   * Authenticates the request user via Bearer JWT.
   * Runs after `resolveProject` on project-scoped routes.
   * Must set `request.jwtPayload` on success.
   */
  authHook: RestHook;
}

// ── Prefer header parsing ─────────────────────────────────────────────────────

interface Prefer {
  count?: string;      // 'exact' | 'planned' | 'estimated'
  return?: string;     // 'representation' | 'minimal' | 'headers-only'
  resolution?: string; // 'merge-duplicates' | 'ignore-duplicates'
  missing?: string;    // 'default' → return null (200) instead of 406 when 0 rows (.maybeSingle)
}

function parsePrefer(header: string | undefined): Prefer {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=');
    if (k && v) result[k.trim()] = v.trim();
  }
  return result;
}

const SINGULAR_CONTENT_TYPE = 'application/vnd.pgrst.object+json';

function isSingularRequest(request: FastifyRequest): boolean {
  const accept = request.headers['accept'] ?? '';
  return accept.includes(SINGULAR_CONTENT_TYPE);
}

function sendSingular(
  reply: FastifyReply,
  rows: Record<string, unknown>[],
  status = 200,
  missingDefault = false,
): ReturnType<FastifyReply['send']> {
  if (rows.length === 0) {
    if (missingDefault) {
      // .maybeSingle() — return null with 200 instead of 406
      return reply.status(200).header('Content-Type', SINGULAR_CONTENT_TYPE).send(null);
    }
    throw new AppError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', {
      details: 'The result contains 0 rows',
      hint: null,
    });
  }
  if (rows.length > 1) {
    throw new AppError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', {
      details: `The result contains ${rows.length} rows`,
      hint: null,
    });
  }
  return reply.status(status).header('Content-Type', SINGULAR_CONTENT_TYPE).send(rows[0]);
}

// Parses an HTTP Range header ("0-9") into offset + limit for pagination.
function parseRangeHeader(header: string | undefined): { offset: number; limit: number } | null {
  if (!header) return null;
  const m = header.match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const from = parseInt(m[1], 10);
  const to   = parseInt(m[2], 10);
  if (from > to) return null;
  return { offset: from, limit: to - from + 1 };
}

// ── Shared route handlers ─────────────────────────────────────────────────────
// These are reused across both route families (apikey routes and project-ref routes).

async function handleGet(request: FastifyRequest, reply: FastifyReply) {
  const { table: tableName } = request.params as { table: string };
  const project = request.project!;
  const projectDb = request.projectDb!;
  const prefer = parsePrefer(request.headers['prefer'] as string | undefined);

  const tables = await introspectSchema(projectDb, 'public', project.ref);
  const table = tables.get(tableName);
  if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

  const parsed = parseQueryParams(request.query as Record<string, string>);

  // Apply Range header when no limit/offset were specified via query params
  if (parsed.limit === null && parsed.offset === 0) {
    const range = parseRangeHeader(request.headers['range'] as string | undefined);
    if (range) {
      parsed.limit  = range.limit;
      parsed.offset = range.offset;
    }
  }

  const selectQuery = buildSelectQuery(table, parsed, tables);
  const wantCount = prefer.count === 'exact' || prefer.count === 'planned' || prefer.count === 'estimated';

  let rows: Record<string, unknown>[];
  let total: number | null = null;

  if (wantCount) {
    const countQuery = buildCountQuery(table, parsed);
    const [data, countResult] = await Promise.all([
      executeWithRlsContext(projectDb, request.jwtPayload, selectQuery.text, selectQuery.values),
      executeWithRlsContext(projectDb, request.jwtPayload, countQuery.text, countQuery.values),
    ]);
    rows = data.rows;
    total = (countResult.rows[0]?.count as number | undefined) ?? 0;
  } else {
    const data = await executeWithRlsContext(projectDb, request.jwtPayload, selectQuery.text, selectQuery.values);
    rows = data.rows;
  }

  const rangeStart = parsed.offset;
  const rangeEnd = rows.length > 0 ? rangeStart + rows.length - 1 : 0;
  const rangeStr = rows.length === 0 ? '*' : `${rangeStart}-${rangeEnd}`;
  reply.header('Content-Range', `${rangeStr}/${total ?? '*'}`);

  if (isSingularRequest(request)) return sendSingular(reply, rows, 200, prefer.missing === 'default');
  return reply.send(rows);
}

async function handlePost(request: FastifyRequest, reply: FastifyReply) {
  const { table: tableName } = request.params as { table: string };
  const project = request.project!;
  const projectDb = request.projectDb!;
  const prefer = parsePrefer(request.headers['prefer'] as string | undefined);

  const tables = await introspectSchema(projectDb, 'public', project.ref);
  const table = tables.get(tableName);
  if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

  const parsed = parseQueryParams(request.query as Record<string, string>);
  const body = request.body;
  if (body === null || body === undefined) throw new BadRequestError('Request body is required');

  const rows = Array.isArray(body)
    ? (body as Record<string, unknown>[])
    : [body as Record<string, unknown>];

  const isUpsert = prefer.resolution === 'merge-duplicates' || prefer.resolution === 'ignore-duplicates';
  const query = isUpsert
    ? buildUpsertQuery(table, rows, prefer.resolution === 'ignore-duplicates', parsed.onConflict)
    : buildInsertQuery(table, rows);

  const result = await executeWithRlsContext(projectDb, request.jwtPayload, query.text, query.values);

  if (prefer.return === 'minimal') {
    return reply.status(204).send();
  }

  if (isSingularRequest(request)) return sendSingular(reply, result.rows, 201, prefer.missing === 'default');
  return reply.status(201).send(result.rows);
}

async function handlePatch(request: FastifyRequest, reply: FastifyReply) {
  const { table: tableName } = request.params as { table: string };
  const project = request.project!;
  const projectDb = request.projectDb!;
  const prefer = parsePrefer(request.headers['prefer'] as string | undefined);

  const tables = await introspectSchema(projectDb, 'public', project.ref);
  const table = tables.get(tableName);
  if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

  const body = request.body as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Request body must be a JSON object');
  }

  const parsed = parseQueryParams(request.query as Record<string, string>);
  const query = buildUpdateQuery(table, body, parsed.filters, parsed.orFilters);
  const result = await executeWithRlsContext(projectDb, request.jwtPayload, query.text, query.values);

  if (prefer.return === 'minimal') {
    return reply.status(204).send();
  }

  if (isSingularRequest(request)) return sendSingular(reply, result.rows, 200, prefer.missing === 'default');
  return reply.send(result.rows);
}

async function handleDelete(request: FastifyRequest, reply: FastifyReply) {
  const { table: tableName } = request.params as { table: string };
  const project = request.project!;
  const projectDb = request.projectDb!;
  const prefer = parsePrefer(request.headers['prefer'] as string | undefined);

  const tables = await introspectSchema(projectDb, 'public', project.ref);
  const table = tables.get(tableName);
  if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

  const parsed = parseQueryParams(request.query as Record<string, string>);
  const query = buildDeleteQuery(table, parsed.filters, parsed.orFilters);
  const result = await executeWithRlsContext(projectDb, request.jwtPayload, query.text, query.values);

  if (prefer.return === 'minimal') {
    return reply.status(204).send();
  }

  if (isSingularRequest(request)) return sendSingular(reply, result.rows, 200, prefer.missing === 'default');
  return reply.send(result.rows);
}

async function handleRpc(request: FastifyRequest, reply: FastifyReply) {
  const { fn: fnName } = request.params as { fn: string };
  const projectDb = request.projectDb!;
  const prefer = parsePrefer(request.headers['prefer'] as string | undefined);

  const body = (request.body ?? {}) as Record<string, unknown>;
  const args = Object.entries(body);

  // Schema is always 'public'. Content-Profile header for per-request schema switching
  // but that requires schema allowlisting — not yet implemented.
  const quotedFn = `public.${quoteIdentifier(fnName)}`;
  let queryText: string;
  let queryValues: unknown[];

  if (args.length === 0) {
    queryText  = `SELECT * FROM ${quotedFn}()`;
    queryValues = [];
  } else {
    const argClauses = args.map(([name, _], i) => `${quoteIdentifier(name)} => $${i + 1}`);
    queryText  = `SELECT * FROM ${quotedFn}(${argClauses.join(', ')})`;
    queryValues = args.map(([_, v]) => v);
  }

  const result = await executeWithRlsContext(projectDb, request.jwtPayload, queryText, queryValues);

  if (prefer.return === 'minimal') return reply.status(204).send();
  if (isSingularRequest(request)) return sendSingular(reply, result.rows, 200, prefer.missing === 'default');
  return reply.send(result.rows);
}

// ── Plugin registration ───────────────────────────────────────────────────────

const restApiPlugin: FastifyPluginAsync<RestApiPluginOptions> = async (fastify, opts) => {
  const { resolveFromApikey, resolveProject, authHook } = opts;

  // Emit Supabase JS client-compatible flat error format so @supabase/postgrest-js can parse
  // error.code / error.message / error.details / error.hint on every error response.
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      // PGRST116 and similar errors pass { details, hint } as the AppError.details object
      const extra = error.details as { details?: unknown; hint?: unknown } | undefined;
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: extra?.details ?? null,
        hint: extra?.hint ?? null,
      });
    }
    if ((error as Error).name === 'ZodError') {
      return reply.status(400).send({
        code: 'PGRST',
        message: 'Request validation failed',
        details: (error as unknown as { issues: unknown[] }).issues,
        hint: null,
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      code: 'PGRST',
      message: 'Internal server error',
      details: null,
      hint: null,
    });
  });

  // ── Supabase-compatible routes ───────────────────────────────────────────
  // Auth and project are resolved from the `apikey` request header.
  // The Supabase JS client hits these: {project-ref}.host/rest/v1/{table}
  fastify.get('/rest/v1/:table',         { preHandler: [resolveFromApikey] }, handleGet);
  fastify.post('/rest/v1/:table',        { preHandler: [resolveFromApikey] }, handlePost);
  fastify.patch('/rest/v1/:table',       { preHandler: [resolveFromApikey] }, handlePatch);
  fastify.delete('/rest/v1/:table',      { preHandler: [resolveFromApikey] }, handleDelete);
  fastify.post('/rest/v1/rpc/:fn',       { preHandler: [resolveFromApikey] }, handleRpc);

  // ── Project-scoped routes ────────────────────────────────────────────────
  // Project resolved from URL param; auth via Bearer JWT.
  // Useful for server-side access and admin tooling.
  fastify.get('/project/:projectRef/rest/v1/:table',      { preHandler: [resolveProject, authHook] }, handleGet);
  fastify.post('/project/:projectRef/rest/v1/:table',     { preHandler: [resolveProject, authHook] }, handlePost);
  fastify.patch('/project/:projectRef/rest/v1/:table',    { preHandler: [resolveProject, authHook] }, handlePatch);
  fastify.delete('/project/:projectRef/rest/v1/:table',   { preHandler: [resolveProject, authHook] }, handleDelete);
  fastify.post('/project/:projectRef/rest/v1/rpc/:fn',    { preHandler: [resolveProject, authHook] }, handleRpc);
};

export default restApiPlugin;
