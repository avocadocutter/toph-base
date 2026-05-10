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
import { createApikeyResolver } from '../../hooks/resolve-project-from-apikey.js';
import { authenticateProject, authenticateProjectOptional } from '../../hooks/authenticate.js';
import { createProjectResolver } from '../../hooks/resolve-project.js';
import { NotFoundError, BadRequestError } from '../../lib/errors.js';

interface Prefer {
  count?: string;
  return?: string;
  resolution?: string;
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

async function handleGet(request: FastifyRequest, reply: FastifyReply) {
  const { table: tableName } = request.params as { table: string };
  const project = request.project!;
  const projectDb = request.projectDb!;
  const prefer = parsePrefer(request.headers['prefer'] as string | undefined);

  const tables = await introspectSchema(projectDb, 'public', project.ref);
  const table = tables.get(tableName);
  if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

  const parsed = parseQueryParams(request.query as Record<string, string>);
  const selectQuery = buildSelectQuery(table, parsed);
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

  const body = request.body;
  if (body === null || body === undefined) throw new BadRequestError('Request body is required');

  const rows = Array.isArray(body)
    ? (body as Record<string, unknown>[])
    : [body as Record<string, unknown>];

  const isUpsert = prefer.resolution === 'merge-duplicates' || prefer.resolution === 'ignore-duplicates';
  const query = isUpsert
    ? buildUpsertQuery(table, rows, prefer.resolution === 'ignore-duplicates')
    : buildInsertQuery(table, rows);

  const result = await executeWithRlsContext(projectDb, request.jwtPayload, query.text, query.values);

  if (prefer.return === 'minimal') {
    return reply.status(204).send();
  }

  reply.status(201);
  return reply.send(result.rows);
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
  const query = buildUpdateQuery(table, body, parsed.filters);
  const result = await executeWithRlsContext(projectDb, request.jwtPayload, query.text, query.values);

  if (prefer.return === 'minimal') {
    return reply.status(204).send();
  }

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
  const query = buildDeleteQuery(table, parsed.filters);
  const result = await executeWithRlsContext(projectDb, request.jwtPayload, query.text, query.values);

  if (prefer.return === 'minimal') {
    return reply.status(204).send();
  }

  return reply.send(result.rows);
}

const restApiPlugin: FastifyPluginAsync = async (fastify) => {
  const resolveFromApikey = createApikeyResolver(fastify.db, fastify.projectPoolManager);
  const resolveProject = createProjectResolver(fastify.db, fastify.projectPoolManager);
  const authHook = fastify.config.features.requireAuthForApi ? authenticateProject : authenticateProjectOptional;

  // Supabase-compatible routes — apikey header auth, subdomain project routing.
  // This is what the Supabase JS client calls: {ref}.host/rest/v1/{table}
  fastify.get('/rest/v1/:table', { preHandler: [resolveFromApikey] }, handleGet);
  fastify.post('/rest/v1/:table', { preHandler: [resolveFromApikey] }, handlePost);
  fastify.patch('/rest/v1/:table', { preHandler: [resolveFromApikey] }, handlePatch);
  fastify.delete('/rest/v1/:table', { preHandler: [resolveFromApikey] }, handleDelete);

  // Project-scoped routes — JWT auth, for admin tooling and server-side access.
  fastify.get('/project/:projectRef/rest/v1/:table', { preHandler: [resolveProject, authHook] }, handleGet);
  fastify.post('/project/:projectRef/rest/v1/:table', { preHandler: [resolveProject, authHook] }, handlePost);
  fastify.patch('/project/:projectRef/rest/v1/:table', { preHandler: [resolveProject, authHook] }, handlePatch);
  fastify.delete('/project/:projectRef/rest/v1/:table', { preHandler: [resolveProject, authHook] }, handleDelete);
};

export default restApiPlugin;
