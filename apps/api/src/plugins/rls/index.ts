import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requirePlatformAdmin } from '../../hooks/authenticate.js';
import { createProjectResolver } from '../../hooks/resolve-project.js';
import { quoteIdentifier, isValidIdentifier, validateRlsPolicyExpression } from '../../lib/sql-helpers.js';
import { z } from 'zod';
import { BadRequestError } from '../../lib/errors.js';
import { invalidateCache } from '../introspection/inspector.js';

const createPolicySchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid policy name'),
  command: z.enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL']),
  permissive: z.boolean().default(true),
  roles: z.array(z.string()).default(['authenticated']),
  using: z.string().optional(),
  withCheck: z.string().optional(),
});

const rlsPlugin: FastifyPluginAsync = async (fastify) => {
  const resolveProject = createProjectResolver(fastify.db, fastify.projectPoolManager);

  // Enable RLS
  fastify.post('/platform/projects/:projectRef/admin/rls/:table/enable', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string; projectRef: string };
    const project = request.project!;
    const projectDb = request.projectDb!;

    if (!isValidIdentifier(table)) {
      throw new BadRequestError('Invalid table name');
    }

    const tableName = quoteIdentifier(table);
    await projectDb.query(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
    await projectDb.query(`ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY`);
    invalidateCache(project.ref);

    return { message: `RLS enabled on ${table}` };
  });

  // Disable RLS
  fastify.post('/platform/projects/:projectRef/admin/rls/:table/disable', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string; projectRef: string };
    const project = request.project!;
    const projectDb = request.projectDb!;

    if (!isValidIdentifier(table)) {
      throw new BadRequestError('Invalid table name');
    }

    const tableName = quoteIdentifier(table);
    await projectDb.query(`ALTER TABLE ${tableName} DISABLE ROW LEVEL SECURITY`);
    await projectDb.query(`ALTER TABLE ${tableName} NO FORCE ROW LEVEL SECURITY`);
    invalidateCache(project.ref);

    return { message: `RLS disabled on ${table}` };
  });

  // List policies
  fastify.get('/platform/projects/:projectRef/admin/rls/:table/policies', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string; projectRef: string };
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
        ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)) AS roles,
        pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
        pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
       FROM pg_policy pol
       JOIN pg_class cls ON pol.polrelid = cls.oid
       JOIN pg_namespace nsp ON cls.relnamespace = nsp.oid
       WHERE nsp.nspname = 'public' AND cls.relname = $1
       ORDER BY pol.polname`,
      [table],
    );

    return result.rows.map(row => ({
      name: row.name,
      table,
      schema: 'public',
      command: row.command,
      permissive: row.permissive,
      roles: row.roles,
      using: row.using_expression,
      withCheck: row.with_check_expression,
    }));
  });

  // Create policy
  fastify.post('/platform/projects/:projectRef/admin/rls/:table/policies', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string; projectRef: string };
    const project = request.project!;
    const projectDb = request.projectDb!;
    const body = createPolicySchema.parse(request.body);

    if (!isValidIdentifier(body.name)) throw new BadRequestError('Invalid policy name');
    if (!isValidIdentifier(table)) {
      throw new BadRequestError('Invalid table name');
    }

    // Validate expressions against SQL injection
    if (body.using) {
      await validateRlsPolicyExpression(projectDb, 'public', table, body.using);
    }
    if (body.withCheck) {
      await validateRlsPolicyExpression(projectDb, 'public', table, body.withCheck);
    }

    const tableName = quoteIdentifier(table);
    const policyName = quoteIdentifier(body.name);
    const permissive = body.permissive ? 'PERMISSIVE' : 'RESTRICTIVE';
    const command = body.command;
    const roles = body.roles.map((r: string) => quoteIdentifier(r)).join(', ');

    let sql = `CREATE POLICY ${policyName} ON ${tableName} AS ${permissive} FOR ${command} TO ${roles}`;

    if (body.using) {
      sql += ` USING (${body.using})`;
    }
    if (body.withCheck) {
      sql += ` WITH CHECK (${body.withCheck})`;
    }

    await projectDb.query(sql);
    invalidateCache(project.ref);

    return { message: `Policy '${body.name}' created on ${table}` };
  });

  // Delete policy
  fastify.delete('/platform/projects/:projectRef/admin/rls/:table/policies/:policyName', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table, policyName } = request.params as { table: string; policyName: string; projectRef: string };
    const project = request.project!;
    const projectDb = request.projectDb!;

    if (!isValidIdentifier(table) || !isValidIdentifier(policyName)) {
      throw new BadRequestError('Invalid identifier');
    }

    const tableName = quoteIdentifier(table);
    await projectDb.query(`DROP POLICY ${quoteIdentifier(policyName)} ON ${tableName}`);
    invalidateCache(project.ref);

    return { message: `Policy '${policyName}' dropped from ${table}` };
  });
};

export default rlsPlugin;
