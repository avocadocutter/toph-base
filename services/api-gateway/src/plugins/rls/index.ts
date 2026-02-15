import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdmin } from '../../hooks/authenticate.js';
import { quoteIdentifier, quoteQualifiedIdentifier, isValidIdentifier } from '../../lib/sql-helpers.js';
import { z } from 'zod';

const createPolicySchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid policy name'),
  table: z.string().min(1),
  schema: z.string().default('public'),
  command: z.enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL']),
  permissive: z.boolean().default(true),
  roles: z.array(z.string()).default(['authenticated']),
  using: z.string().optional(),
  withCheck: z.string().optional(),
});
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { invalidateCache } from '../introspection/inspector.js';

const rlsPlugin: FastifyPluginAsync = async (fastify) => {
  // Get RLS status for a table
  fastify.get('/admin/rls/:schema/:table/status', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const { schema, table } = request.params as { schema: string; table: string };
    const result = await fastify.db.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON c.relnamespace = n.oid
       WHERE n.nspname = $1 AND c.relname = $2`,
      [schema, table],
    );

    if (result.rows.length === 0) throw new NotFoundError(`Table '${schema}.${table}' not found`);

    return {
      table: `${schema}.${table}`,
      rlsEnabled: result.rows[0].relrowsecurity,
      rlsForced: result.rows[0].relforcerowsecurity,
    };
  });

  // Enable RLS on a table
  fastify.post('/admin/rls/:schema/:table/enable', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const { schema, table } = request.params as { schema: string; table: string };
    if (!isValidIdentifier(schema) || !isValidIdentifier(table)) {
      throw new BadRequestError('Invalid schema or table name');
    }

    const qualified = quoteQualifiedIdentifier(schema, table);
    await fastify.db.query(`ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY`);
    await fastify.db.query(`ALTER TABLE ${qualified} FORCE ROW LEVEL SECURITY`);
    invalidateCache();

    return { message: `RLS enabled on ${schema}.${table}` };
  });

  // Disable RLS on a table
  fastify.post('/admin/rls/:schema/:table/disable', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const { schema, table } = request.params as { schema: string; table: string };
    if (!isValidIdentifier(schema) || !isValidIdentifier(table)) {
      throw new BadRequestError('Invalid schema or table name');
    }

    const qualified = quoteQualifiedIdentifier(schema, table);
    await fastify.db.query(`ALTER TABLE ${qualified} DISABLE ROW LEVEL SECURITY`);
    await fastify.db.query(`ALTER TABLE ${qualified} NO FORCE ROW LEVEL SECURITY`);
    invalidateCache();

    return { message: `RLS disabled on ${schema}.${table}` };
  });

  // List RLS policies for a table
  fastify.get('/admin/rls/:schema/:table/policies', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const { schema, table } = request.params as { schema: string; table: string };

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
      [schema, table],
    );

    return result.rows.map(row => ({
      name: row.name,
      table: `${schema}.${table}`,
      schema,
      command: row.command,
      permissive: row.permissive,
      roles: row.roles,
      using: row.using_expression,
      withCheck: row.with_check_expression,
    }));
  });

  // Create an RLS policy
  fastify.post('/admin/rls/:schema/:table/policies', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const { schema, table } = request.params as { schema: string; table: string };
    const body = createPolicySchema.parse({ ...(request.body as object), table, schema });

    if (!isValidIdentifier(body.name)) throw new BadRequestError('Invalid policy name');
    if (!isValidIdentifier(schema) || !isValidIdentifier(table)) {
      throw new BadRequestError('Invalid schema or table name');
    }

    const qualifiedTable = quoteQualifiedIdentifier(schema, table);
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
    invalidateCache();

    return { message: `Policy '${body.name}' created on ${schema}.${table}` };
  });

  // Delete an RLS policy
  fastify.delete('/admin/rls/:schema/:table/policies/:policyName', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const { schema, table, policyName } = request.params as { schema: string; table: string; policyName: string };

    if (!isValidIdentifier(schema) || !isValidIdentifier(table) || !isValidIdentifier(policyName)) {
      throw new BadRequestError('Invalid identifier');
    }

    const qualifiedTable = quoteQualifiedIdentifier(schema, table);
    await fastify.db.query(`DROP POLICY ${quoteIdentifier(policyName)} ON ${qualifiedTable}`);
    invalidateCache();

    return { message: `Policy '${policyName}' dropped from ${schema}.${table}` };
  });

  // Get policy templates
  fastify.get('/admin/rls/templates', { preHandler: [requireAdmin] }, async () => {
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
};

export default rlsPlugin;
