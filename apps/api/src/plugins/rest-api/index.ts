import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { introspectSchema } from '../introspection/inspector.js';
import { parseQueryParams } from './query-parser.js';
import { buildSelectQuery, buildCountQuery, buildInsertQuery, buildUpdateQuery, buildDeleteQuery } from './query-builder.js';
import { executeWithRlsContext } from './rls-context.js';
import { authenticateProject, authenticateProjectOptional } from '../../hooks/authenticate.js';
import { createProjectResolver } from '../../hooks/resolve-project.js';
import { NotFoundError, BadRequestError } from '../../lib/errors.js';

const restApiPlugin: FastifyPluginAsync = async (fastify) => {
  const resolveProject = createProjectResolver(fastify.db, fastify.projectPoolManager);
  const authHook = fastify.config.features.requireAuthForApi ? authenticateProject : authenticateProjectOptional;

  // GET /project/:projectRef/rest/v1/:table - List rows
  fastify.get('/project/:projectRef/rest/v1/:table', {
    preHandler: [resolveProject, authHook],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { table: tableName } = request.params as { table: string; projectRef: string };
    const project = request.project!;
    const projectDb = request.projectDb!;
    const tables = await introspectSchema(projectDb, 'public', project.ref);
    const table = tables.get(tableName);
    if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

    const parsed = parseQueryParams(request.query as Record<string, string>);
    const selectQuery = buildSelectQuery(table, parsed);
    const countQuery = buildCountQuery(table, parsed);

    const [data, countResult] = await Promise.all([
      executeWithRlsContext(projectDb, request.jwtPayload, selectQuery.text, selectQuery.values),
      executeWithRlsContext(projectDb, request.jwtPayload, countQuery.text, countQuery.values),
    ]);

    const total = countResult.rows[0]?.count ?? 0;
    const limit = parsed.limit ?? 100;
    const rangeStart = parsed.offset;
    const rangeEnd = rangeStart + data.rows.length - 1;

    reply.header('Content-Range', `${rangeStart}-${rangeEnd}/${total}`);
    reply.header('X-Total-Count', String(total));

    return { data: data.rows, count: total, limit, offset: parsed.offset };
  });

  // POST /project/:projectRef/rest/v1/:table - Insert row(s)
  fastify.post('/project/:projectRef/rest/v1/:table', {
    preHandler: [resolveProject, authHook],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { table: tableName } = request.params as { table: string; projectRef: string };
    const project = request.project!;
    const projectDb = request.projectDb!;
    const tables = await introspectSchema(projectDb, 'public', project.ref);
    const table = tables.get(tableName);
    if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

    const body = request.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') throw new BadRequestError('Request body must be a JSON object');

    const query = buildInsertQuery(table, body);
    const result = await executeWithRlsContext(projectDb, request.jwtPayload, query.text, query.values);

    reply.status(201);
    return result.rows[0];
  });

  // PATCH /project/:projectRef/rest/v1/:table - Update rows
  fastify.patch('/project/:projectRef/rest/v1/:table', {
    preHandler: [resolveProject, authHook],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { table: tableName } = request.params as { table: string; projectRef: string };
    const project = request.project!;
    const projectDb = request.projectDb!;
    const tables = await introspectSchema(projectDb, 'public', project.ref);
    const table = tables.get(tableName);
    if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

    const body = request.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') throw new BadRequestError('Request body must be a JSON object');

    const queryParams = request.query as Record<string, string>;
    const parsed = parseQueryParams(queryParams);

    const query = buildUpdateQuery(table, body, parsed.filters);
    const result = await executeWithRlsContext(projectDb, request.jwtPayload, query.text, query.values);

    return result.rows;
  });

  // DELETE /project/:projectRef/rest/v1/:table - Delete rows
  fastify.delete('/project/:projectRef/rest/v1/:table', {
    preHandler: [resolveProject, authHook],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { table: tableName } = request.params as { table: string; projectRef: string };
    const project = request.project!;
    const projectDb = request.projectDb!;
    const tables = await introspectSchema(projectDb, 'public', project.ref);
    const table = tables.get(tableName);
    if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

    const queryParams = request.query as Record<string, string>;
    const parsed = parseQueryParams(queryParams);

    const query = buildDeleteQuery(table, parsed.filters);
    const result = await executeWithRlsContext(projectDb, request.jwtPayload, query.text, query.values);

    return result.rows;
  });
};

export default restApiPlugin;
