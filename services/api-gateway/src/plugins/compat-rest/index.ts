import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { introspectSchema } from '../introspection/inspector.js';
import { parseQueryParams } from '../rest-api/query-parser.js';
import { buildSelectQuery, buildCountQuery, buildInsertQuery, buildUpdateQuery, buildDeleteQuery } from '../rest-api/query-builder.js';
import { executeWithRlsContext } from '../rest-api/rls-context.js';
import { createApikeyResolver } from '../../hooks/resolve-project-from-apikey.js';
import { NotFoundError, BadRequestError } from '../../lib/errors.js';

function parsePreferHeader(request: FastifyRequest): { returnRepresentation: boolean; countExact: boolean } {
  const prefer = request.headers['prefer'] as string | undefined;
  if (!prefer) return { returnRepresentation: false, countExact: false };

  const parts = prefer.split(',').map(s => s.trim());
  return {
    returnRepresentation: parts.includes('return=representation'),
    countExact: parts.includes('count=exact'),
  };
}

function cleanSelectColumns(selectParam: string | undefined): string | undefined {
  if (!selectParam) return undefined;

  // Strip relation references like "comments(*)" — keep only plain columns
  const columns = selectParam
    .split(',')
    .map(s => s.trim())
    .filter(s => !s.includes('('))
    .filter(Boolean);

  return columns.length > 0 ? columns.join(',') : undefined;
}

const compatRestPlugin: FastifyPluginAsync = async (fastify) => {
  const resolveFromApikey = createApikeyResolver(fastify.db);

  // GET /rest/v1/:table
  fastify.get('/rest/v1/:table', {
    preHandler: [resolveFromApikey],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { table: tableName } = request.params as { table: string };
    const project = request.project!;
    const tables = await introspectSchema(fastify.db, project.schemaName);
    const table = tables.get(tableName);
    if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

    const queryParams = request.query as Record<string, string>;
    const prefer = parsePreferHeader(request);

    // Clean select param: handle "*" (all columns) and strip relation references
    const rawSelect = queryParams.select;
    const cleanedSelect = rawSelect === '*' ? undefined : cleanSelectColumns(rawSelect);
    const parsedParams = { ...queryParams, select: cleanedSelect };

    const parsed = parseQueryParams(parsedParams);
    const selectQuery = buildSelectQuery(table, parsed);
    const result = await executeWithRlsContext(
      fastify.db, request.jwtPayload, selectQuery.text, selectQuery.values, project.schemaName,
    );

    if (prefer.countExact) {
      const countQuery = buildCountQuery(table, parsed);
      const countResult = await executeWithRlsContext(
        fastify.db, request.jwtPayload, countQuery.text, countQuery.values, project.schemaName,
      );
      const total = countResult.rows[0]?.count ?? 0;
      const rangeStart = parsed.offset;
      const rangeEnd = rangeStart + result.rows.length - 1;
      reply.header('Content-Range', `${rangeStart}-${rangeEnd}/${total}`);
      reply.header('X-Total-Count', String(total));
    }

    return result.rows;
  });

  // POST /rest/v1/:table
  fastify.post('/rest/v1/:table', {
    preHandler: [resolveFromApikey],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { table: tableName } = request.params as { table: string };
    const project = request.project!;
    const tables = await introspectSchema(fastify.db, project.schemaName);
    const table = tables.get(tableName);
    if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

    const prefer = parsePreferHeader(request);
    const rawBody = request.body;

    if (!rawBody || typeof rawBody !== 'object') {
      throw new BadRequestError('Request body must be a JSON object or array');
    }

    const rows = Array.isArray(rawBody) ? rawBody : [rawBody];
    const insertedRows: Record<string, unknown>[] = [];

    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        throw new BadRequestError('Each item must be a JSON object');
      }
      const query = buildInsertQuery(table, row as Record<string, unknown>);
      const result = await executeWithRlsContext(
        fastify.db, request.jwtPayload, query.text, query.values, project.schemaName,
      );
      if (result.rows[0]) insertedRows.push(result.rows[0]);
    }

    if (prefer.returnRepresentation) {
      reply.status(201);
      return Array.isArray(rawBody) ? insertedRows : insertedRows[0];
    }

    reply.status(201).send('');
  });

  // PATCH /rest/v1/:table
  fastify.patch('/rest/v1/:table', {
    preHandler: [resolveFromApikey],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { table: tableName } = request.params as { table: string };
    const project = request.project!;
    const tables = await introspectSchema(fastify.db, project.schemaName);
    const table = tables.get(tableName);
    if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

    const body = request.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      throw new BadRequestError('Request body must be a JSON object');
    }

    const queryParams = request.query as Record<string, string>;
    const parsed = parseQueryParams(queryParams);
    const prefer = parsePreferHeader(request);

    const query = buildUpdateQuery(table, body, parsed.filters);
    const result = await executeWithRlsContext(
      fastify.db, request.jwtPayload, query.text, query.values, project.schemaName,
    );

    if (prefer.returnRepresentation) {
      return result.rows;
    }

    reply.status(204).send('');
  });

  // DELETE /rest/v1/:table
  fastify.delete('/rest/v1/:table', {
    preHandler: [resolveFromApikey],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { table: tableName } = request.params as { table: string };
    const project = request.project!;
    const tables = await introspectSchema(fastify.db, project.schemaName);
    const table = tables.get(tableName);
    if (!table) throw new NotFoundError(`Table '${tableName}' not found`);

    const queryParams = request.query as Record<string, string>;
    const parsed = parseQueryParams(queryParams);
    const prefer = parsePreferHeader(request);

    const query = buildDeleteQuery(table, parsed.filters);
    const result = await executeWithRlsContext(
      fastify.db, request.jwtPayload, query.text, query.values, project.schemaName,
    );

    if (prefer.returnRepresentation) {
      return result.rows;
    }

    reply.status(204).send('');
  });
};

export default compatRestPlugin;
