import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { resolveLocalProject } from '../../hooks/resolve-project.js';
import { quoteIdentifier, isValidIdentifier, validateRlsPolicyExpression } from '../../lib/sql-helpers.js';
import { z } from 'zod';
import { BadRequestError } from '../../lib/errors.js';
import { invalidateCache } from '../introspection/inspector.js';

const sqlQuerySchema = z.object({
  query: z.string().min(1, 'Query is required').max(100000),
});

const createPolicySchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid policy name'),
  command: z.enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL']),
  permissive: z.boolean().default(true),
  roles: z.array(z.string()).default(['authenticated']),
  using: z.string().optional(),
  withCheck: z.string().optional(),
});

const rlsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/admin/sql', {
    preHandler: [resolveLocalProject],
  }, async (request: FastifyRequest) => {
    const projectDb = request.projectDb!;
    const body = sqlQuerySchema.parse(request.body);
    const startTime = Date.now();

    try {
      const result = await projectDb.query(body.query);
      const duration = Date.now() - startTime;
      invalidateCache('local');

      return {
        rows: result.rows ?? [],
        rowCount: result.rowCount ?? 0,
        fields: result.fields?.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })) ?? [],
        duration,
      };
    } catch (error: unknown) {
      const pgError = error as { message: string; position?: string; detail?: string; hint?: string };
      throw new BadRequestError('SQL execution error', {
        message: pgError.message,
        position: pgError.position,
        detail: pgError.detail,
        hint: pgError.hint,
      });
    }
  });

  // RLS management routes — accessible locally (no platform auth required in single-project mode)

  fastify.post('/admin/rls/:table/enable', {
    preHandler: [resolveLocalProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string };
    const projectDb = request.projectDb!;
    if (!isValidIdentifier(table)) throw new BadRequestError('Invalid table name');
    const tableName = quoteIdentifier(table);
    await projectDb.query(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
    await projectDb.query(`ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY`);
    invalidateCache('local');
    return { message: `RLS enabled on ${table}` };
  });

  fastify.post('/admin/rls/:table/disable', {
    preHandler: [resolveLocalProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string };
    const projectDb = request.projectDb!;
    if (!isValidIdentifier(table)) throw new BadRequestError('Invalid table name');
    const tableName = quoteIdentifier(table);
    await projectDb.query(`ALTER TABLE ${tableName} DISABLE ROW LEVEL SECURITY`);
    await projectDb.query(`ALTER TABLE ${tableName} NO FORCE ROW LEVEL SECURITY`);
    invalidateCache('local');
    return { message: `RLS disabled on ${table}` };
  });

  fastify.get('/admin/rls/:table/policies', {
    preHandler: [resolveLocalProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string };
    const projectDb = request.projectDb!;
    const result = await projectDb.query(
      `SELECT
        pol.polname AS name,
        CASE pol.polcmd
          WHEN '*' THEN 'ALL'
          WHEN 'r' THEN 'SELECT'
          WHEN 'a' THEN 'INSERT'
          WHEN 'w' THEN 'UPDATE'
          WHEN 'd' THEN 'DELETE'
        END AS command,
        pol.polpermissive AS permissive,
        pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
        pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
       FROM pg_policy pol
       JOIN pg_class cls ON pol.polrelid = cls.oid
       JOIN pg_namespace nsp ON cls.relnamespace = nsp.oid
       WHERE nsp.nspname = 'public' AND cls.relname = $1
       ORDER BY pol.polname`,
      [table],
    );
    return result.rows;
  });

  fastify.post('/admin/rls/:table/policies', {
    preHandler: [resolveLocalProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string };
    const projectDb = request.projectDb!;
    const body = createPolicySchema.parse(request.body);
    if (!isValidIdentifier(body.name)) throw new BadRequestError('Invalid policy name');
    if (!isValidIdentifier(table)) throw new BadRequestError('Invalid table name');
    if (body.using) await validateRlsPolicyExpression(projectDb, 'public', table, body.using);
    if (body.withCheck) await validateRlsPolicyExpression(projectDb, 'public', table, body.withCheck);
    const tableName = quoteIdentifier(table);
    const policyName = quoteIdentifier(body.name);
    const roles = body.roles.map((r: string) => quoteIdentifier(r)).join(', ');
    let sql = `CREATE POLICY ${policyName} ON ${tableName} AS ${body.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${body.command} TO ${roles}`;
    if (body.using) sql += ` USING (${body.using})`;
    if (body.withCheck) sql += ` WITH CHECK (${body.withCheck})`;
    await projectDb.query(sql);
    invalidateCache('local');
    return { message: `Policy '${body.name}' created on ${table}` };
  });

  fastify.delete('/admin/rls/:table/policies/:policyName', {
    preHandler: [resolveLocalProject],
  }, async (request: FastifyRequest) => {
    const { table, policyName } = request.params as { table: string; policyName: string };
    const projectDb = request.projectDb!;
    if (!isValidIdentifier(table) || !isValidIdentifier(policyName)) throw new BadRequestError('Invalid identifier');
    await projectDb.query(`DROP POLICY ${quoteIdentifier(policyName)} ON ${quoteIdentifier(table)}`);
    invalidateCache('local');
    return { message: `Policy '${policyName}' dropped from ${table}` };
  });
};

export default rlsPlugin;
