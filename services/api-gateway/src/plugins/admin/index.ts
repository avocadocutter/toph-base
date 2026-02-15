import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdmin } from '../../hooks/authenticate.js';
import { introspectSchema, invalidateCache } from '../introspection/inspector.js';
import { quoteIdentifier, quoteQualifiedIdentifier, isValidIdentifier } from '../../lib/sql-helpers.js';
import { z } from 'zod';

const createTableSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid table name'),
  schema: z.string().default('public'),
  columns: z.array(z.object({
    name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid column name'),
    type: z.string().min(1),
    nullable: z.boolean().default(true),
    defaultValue: z.string().optional(),
    primaryKey: z.boolean().default(false),
  })).min(1, 'At least one column is required'),
  enableRls: z.boolean().default(false),
});

const sqlQuerySchema = z.object({
  query: z.string().min(1, 'Query is required').max(100000),
});
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

const adminPlugin: FastifyPluginAsync = async (fastify) => {
  // List all tables
  fastify.get('/admin/tables', { preHandler: [requireAdmin] }, async () => {
    const tables = await introspectSchema(fastify.db);
    return Array.from(tables.values()).map(t => ({
      schema: t.schema,
      name: t.name,
      type: t.type,
      columnCount: t.columns.length,
      primaryKey: t.primaryKey,
      rlsEnabled: t.rlsEnabled,
      rlsForced: t.rlsForced,
    }));
  });

  // Get table details (columns, foreign keys)
  fastify.get('/admin/tables/:schema/:table', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const { schema, table } = request.params as { schema: string; table: string };
    const tables = await introspectSchema(fastify.db, schema);
    const info = tables.get(table);
    if (!info) throw new NotFoundError(`Table '${schema}.${table}' not found`);

    // Get row count
    const countResult = await fastify.db.query(
      `SELECT count(*)::int AS count FROM ${quoteQualifiedIdentifier(schema, table)}`,
    );

    return {
      ...info,
      rowCount: countResult.rows[0]?.count ?? 0,
    };
  });

  // Create a new table
  fastify.post('/admin/tables', { preHandler: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createTableSchema.parse(request.body);

    if (!isValidIdentifier(body.name)) throw new BadRequestError('Invalid table name');

    const qualifiedName = quoteQualifiedIdentifier(body.schema, body.name);
    const columnDefs = body.columns.map((col: { name: string; type: string; nullable: boolean; defaultValue?: string; primaryKey: boolean }) => {
      if (!isValidIdentifier(col.name)) throw new BadRequestError(`Invalid column name: ${col.name}`);
      let def = `${quoteIdentifier(col.name)} ${col.type}`;
      if (col.primaryKey) def += ' PRIMARY KEY';
      if (!col.nullable) def += ' NOT NULL';
      if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
      return def;
    });

    const sql = `CREATE TABLE ${qualifiedName} (\n  ${columnDefs.join(',\n  ')}\n)`;
    await fastify.db.query(sql);

    if (body.enableRls) {
      await fastify.db.query(`ALTER TABLE ${qualifiedName} ENABLE ROW LEVEL SECURITY`);
      await fastify.db.query(`ALTER TABLE ${qualifiedName} FORCE ROW LEVEL SECURITY`);
    }

    // Grant permissions to API roles
    await fastify.db.query(`GRANT SELECT ON ${qualifiedName} TO anon`);
    await fastify.db.query(`GRANT ALL ON ${qualifiedName} TO authenticated`);
    await fastify.db.query(`GRANT ALL ON ${qualifiedName} TO service_role`);

    invalidateCache();
    reply.status(201);
    return { message: `Table ${body.schema}.${body.name} created`, sql };
  });

  // Drop a table
  fastify.delete('/admin/tables/:schema/:table', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const { schema, table } = request.params as { schema: string; table: string };
    if (!isValidIdentifier(schema) || !isValidIdentifier(table)) {
      throw new BadRequestError('Invalid identifier');
    }

    await fastify.db.query(`DROP TABLE ${quoteQualifiedIdentifier(schema, table)} CASCADE`);
    invalidateCache();

    return { message: `Table ${schema}.${table} dropped` };
  });

  // Execute arbitrary SQL (admin only)
  fastify.post('/admin/sql', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const body = sqlQuerySchema.parse(request.body);
    const startTime = Date.now();

    try {
      // Execute with a 30-second timeout to prevent runaway queries
      const client = await fastify.db.connect();
      try {
        await client.query('SET statement_timeout = 30000');
        var result = await client.query(body.query);
      } finally {
        await client.query('RESET statement_timeout');
        client.release();
      }
      const duration = Date.now() - startTime;
      invalidateCache(); // DDL might have changed the schema

      return {
        rows: result.rows ?? [],
        rowCount: result.rowCount ?? 0,
        fields: result.fields?.map((f: { name: string; dataTypeID: number }) => ({ name: f.name, dataTypeID: f.dataTypeID })) ?? [],
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

  // List users (admin)
  fastify.get('/admin/users', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const query = request.query as { search?: string; limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 100);
    const offset = parseInt(query.offset ?? '0', 10);

    let sql = `SELECT id, email, role, email_confirmed, is_disabled, created_at, updated_at, last_sign_in_at
               FROM toph_internal.users`;
    const values: unknown[] = [];

    if (query.search) {
      sql += ' WHERE email ILIKE $1';
      values.push(`%${query.search}%`);
    }

    sql += ' ORDER BY created_at DESC';
    sql += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const result = await fastify.db.query(sql, values);

    // Count total
    let countSql = 'SELECT count(*)::int AS count FROM toph_internal.users';
    const countValues: unknown[] = [];
    if (query.search) {
      countSql += ' WHERE email ILIKE $1';
      countValues.push(`%${query.search}%`);
    }
    const countResult = await fastify.db.query(countSql, countValues);

    return {
      data: result.rows.map(u => ({
        id: u.id,
        email: u.email,
        role: u.role,
        emailConfirmed: u.email_confirmed,
        isDisabled: u.is_disabled,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
        lastSignInAt: u.last_sign_in_at,
      })),
      count: countResult.rows[0]?.count ?? 0,
      limit,
      offset,
    };
  });

  // Update a user (admin)
  fastify.patch('/admin/users/:id', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const body = request.body as { role?: string; isDisabled?: boolean };

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.role !== undefined) {
      if (!['admin', 'authenticated'].includes(body.role)) {
        throw new BadRequestError("Role must be 'admin' or 'authenticated'");
      }
      updates.push(`role = $${paramIndex++}`);
      values.push(body.role);
    }

    if (body.isDisabled !== undefined) {
      updates.push(`is_disabled = $${paramIndex++}`);
      values.push(body.isDisabled);
    }

    if (updates.length === 0) throw new BadRequestError('No fields to update');

    updates.push(`updated_at = now()`);
    values.push(id);

    const sql = `UPDATE toph_internal.users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, email, role, is_disabled, updated_at`;
    const result = await fastify.db.query(sql, values);

    if (result.rows.length === 0) throw new NotFoundError('User not found');
    return result.rows[0];
  });

  // Delete a user (admin)
  fastify.delete('/admin/users/:id', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const result = await fastify.db.query(
      'DELETE FROM toph_internal.users WHERE id = $1 RETURNING id',
      [id],
    );

    if (result.rows.length === 0) throw new NotFoundError('User not found');
    return { message: 'User deleted' };
  });

  // Get settings
  fastify.get('/admin/settings', { preHandler: [requireAdmin] }, async () => {
    const result = await fastify.db.query('SELECT key, value FROM toph_internal.settings ORDER BY key');
    const settings: Record<string, unknown> = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
    return settings;
  });

  // Update settings
  fastify.patch('/admin/settings', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const body = request.body as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      await fastify.db.query(
        `INSERT INTO toph_internal.settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    }
    return { message: 'Settings updated' };
  });

  // Health check
  fastify.get('/health', async () => {
    try {
      const result = await fastify.db.query('SELECT version()');
      return {
        status: 'healthy',
        database: {
          connected: true,
          version: result.rows[0].version,
        },
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        status: 'unhealthy',
        database: { connected: false },
        timestamp: new Date().toISOString(),
      };
    }
  });

  // Force schema cache refresh
  fastify.post('/admin/schema/refresh', { preHandler: [requireAdmin] }, async () => {
    invalidateCache();
    const tables = await introspectSchema(fastify.db);
    return { message: 'Schema cache refreshed', tableCount: tables.size };
  });

  // List extensions
  fastify.get('/admin/extensions', { preHandler: [requireAdmin] }, async () => {
    const installed = await fastify.db.query(
      `SELECT extname AS name, extversion AS version
       FROM pg_extension ORDER BY extname`,
    );
    const available = await fastify.db.query(
      `SELECT name, default_version, comment
       FROM pg_available_extensions
       WHERE name NOT IN (SELECT extname FROM pg_extension)
       ORDER BY name`,
    );
    return {
      installed: installed.rows,
      available: available.rows,
    };
  });

  // Enable extension
  fastify.post('/admin/extensions/:name', { preHandler: [requireAdmin] }, async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    if (!isValidIdentifier(name)) throw new BadRequestError('Invalid extension name');
    await fastify.db.query(`CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(name)}`);
    return { message: `Extension '${name}' enabled` };
  });
};

export default adminPlugin;
