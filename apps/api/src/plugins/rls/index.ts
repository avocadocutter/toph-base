import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requirePlatformAdmin } from '../../hooks/authenticate.js';
import { createProjectResolver } from '../../hooks/resolve-project.js';
import { quoteIdentifier, quoteQualifiedIdentifier, isValidIdentifier, validateRlsPolicyExpression } from '../../lib/sql-helpers.js';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
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
  const resolveProject = createProjectResolver(fastify.db);

  // Policy templates (no project scope needed)
  fastify.get('/platform/admin/rls/templates', { preHandler: [requirePlatformAdmin] }, async () => {
    return [
      {
        name: 'Owner-based access',
        description: 'Users can only access their own rows',
        command: 'ALL',
        using: "auth_uid() = user_id",
        withCheck: "auth_uid() = user_id",
      },
      {
        name: 'Public read, owner write',
        description: 'Anyone can read, only the owner can write',
        command: 'SELECT',
        using: 'true',
        withCheck: null,
      },
      {
        name: 'Authenticated read-only',
        description: 'Authenticated users can read all rows',
        command: 'SELECT',
        using: "auth_role() = 'authenticated'",
        withCheck: null,
      },
      {
        name: 'Admin full access',
        description: 'Admins have full access',
        command: 'ALL',
        using: "auth_role() = 'admin'",
        withCheck: "auth_role() = 'admin'",
      },
    ];
  });

  // ── Project-scoped RLS routes ──

  // Get RLS status for a table
  fastify.get('/platform/projects/:projectRef/admin/rls/:table/status', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string; projectRef: string };
    const project = request.project!;

    const result = await fastify.db.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON c.relnamespace = n.oid
       WHERE n.nspname = $1 AND c.relname = $2`,
      [project.schemaName, table],
    );

    if (result.rows.length === 0) throw new NotFoundError(`Table '${table}' not found`);

    return {
      table: `${project.schemaName}.${table}`,
      rlsEnabled: result.rows[0].relrowsecurity,
      rlsForced: result.rows[0].relforcerowsecurity,
    };
  });

  // Enable RLS
  fastify.post('/platform/projects/:projectRef/admin/rls/:table/enable', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string; projectRef: string };
    const project = request.project!;

    if (!isValidIdentifier(table)) {
      throw new BadRequestError('Invalid table name');
    }

    const qualified = quoteQualifiedIdentifier(project.schemaName, table);
    await fastify.db.query(`ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY`);
    await fastify.db.query(`ALTER TABLE ${qualified} FORCE ROW LEVEL SECURITY`);
    invalidateCache(project.schemaName);

    return { message: `RLS enabled on ${project.schemaName}.${table}` };
  });

  // Disable RLS
  fastify.post('/platform/projects/:projectRef/admin/rls/:table/disable', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string; projectRef: string };
    const project = request.project!;

    if (!isValidIdentifier(table)) {
      throw new BadRequestError('Invalid table name');
    }

    const qualified = quoteQualifiedIdentifier(project.schemaName, table);
    await fastify.db.query(`ALTER TABLE ${qualified} DISABLE ROW LEVEL SECURITY`);
    await fastify.db.query(`ALTER TABLE ${qualified} NO FORCE ROW LEVEL SECURITY`);
    invalidateCache(project.schemaName);

    return { message: `RLS disabled on ${project.schemaName}.${table}` };
  });

  // List policies
  fastify.get('/platform/projects/:projectRef/admin/rls/:table/policies', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string; projectRef: string };
    const project = request.project!;

    const result = await fastify.db.query(
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
       WHERE nsp.nspname = $1 AND cls.relname = $2
       ORDER BY pol.polname`,
      [project.schemaName, table],
    );

    return result.rows.map(row => ({
      name: row.name,
      table: `${project.schemaName}.${table}`,
      schema: project.schemaName,
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
    const body = createPolicySchema.parse(request.body);

    if (!isValidIdentifier(body.name)) throw new BadRequestError('Invalid policy name');
    if (!isValidIdentifier(table)) {
      throw new BadRequestError('Invalid table name');
    }

    // Validate expressions against SQL injection
    if (body.using) {
      await validateRlsPolicyExpression(fastify.db, project.schemaName, table, body.using);
    }
    if (body.withCheck) {
      await validateRlsPolicyExpression(fastify.db, project.schemaName, table, body.withCheck);
    }

    const qualifiedTable = quoteQualifiedIdentifier(project.schemaName, table);
    const policyName = quoteIdentifier(body.name);
    const permissive = body.permissive ? 'PERMISSIVE' : 'RESTRICTIVE';
    const command = body.command;
    const roles = body.roles.map((r: string) => quoteIdentifier(r)).join(', ');

    let sql = `CREATE POLICY ${policyName} ON ${qualifiedTable} AS ${permissive} FOR ${command} TO ${roles}`;

    if (body.using) {
      sql += ` USING (${body.using})`;
    }
    if (body.withCheck) {
      sql += ` WITH CHECK (${body.withCheck})`;
    }

    await fastify.db.query(sql);
    invalidateCache(project.schemaName);

    return { message: `Policy '${body.name}' created on ${project.schemaName}.${table}` };
  });

  // Delete policy
  fastify.delete('/platform/projects/:projectRef/admin/rls/:table/policies/:policyName', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table, policyName } = request.params as { table: string; policyName: string; projectRef: string };
    const project = request.project!;

    if (!isValidIdentifier(table) || !isValidIdentifier(policyName)) {
      throw new BadRequestError('Invalid identifier');
    }

    const qualifiedTable = quoteQualifiedIdentifier(project.schemaName, table);
    await fastify.db.query(`DROP POLICY ${quoteIdentifier(policyName)} ON ${qualifiedTable}`);
    invalidateCache(project.schemaName);

    return { message: `Policy '${policyName}' dropped from ${project.schemaName}.${table}` };
  });
};

export default rlsPlugin;
