import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { requirePlatformAdmin } from '../../hooks/authenticate.js';
import { createProjectResolver } from '../../hooks/resolve-project.js';
import { introspectSchema, invalidateCache } from '../introspection/inspector.js';
import { quoteIdentifier, quoteQualifiedIdentifier, isValidIdentifier } from '../../lib/sql-helpers.js';
import { validateColumnType, validateDefaultValue } from '../../lib/sql-types.js';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

const createTableSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid table name'),
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

const adminPlugin: FastifyPluginAsync = async (fastify) => {
  const resolveProject = createProjectResolver(fastify.db);

  // ============================================================
  // Platform-level admin routes
  // ============================================================

  // List platform users
  fastify.get('/platform/admin/users', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const query = request.query as { search?: string; limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 100);
    const offset = parseInt(query.offset ?? '0', 10);

    let sql = `SELECT id, email, role, email_confirmed, is_disabled, created_at, updated_at, last_sign_in_at
               FROM toph_internal.platform_users`;
    const values: unknown[] = [];

    if (query.search) {
      sql += ' WHERE email ILIKE $1';
      values.push(`%${query.search}%`);
    }

    sql += ' ORDER BY created_at DESC';
    sql += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const result = await fastify.db.query(sql, values);

    let countSql = 'SELECT count(*)::int AS count FROM toph_internal.platform_users';
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

  // Update a platform user
  fastify.patch('/platform/admin/users/:id', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const body = request.body as { isDisabled?: boolean };

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.isDisabled !== undefined) {
      updates.push(`is_disabled = $${paramIndex++}`);
      values.push(body.isDisabled);
    }

    if (updates.length === 0) throw new BadRequestError('No fields to update');

    updates.push(`updated_at = now()`);
    values.push(id);

    const sql = `UPDATE toph_internal.platform_users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, email, role, is_disabled, updated_at`;
    const result = await fastify.db.query(sql, values);

    if (result.rows.length === 0) throw new NotFoundError('User not found');
    return result.rows[0];
  });

  // Delete a platform user
  fastify.delete('/platform/admin/users/:id', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const result = await fastify.db.query(
      'DELETE FROM toph_internal.platform_users WHERE id = $1 RETURNING id',
      [id],
    );

    if (result.rows.length === 0) throw new NotFoundError('User not found');
    return { message: 'User deleted' };
  });

  // Get settings
  fastify.get('/platform/admin/settings', { preHandler: [requirePlatformAdmin] }, async () => {
    const result = await fastify.db.query('SELECT key, value FROM toph_internal.settings ORDER BY key');
    const settings: Record<string, unknown> = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
    return settings;
  });

  // Update settings
  fastify.patch('/platform/admin/settings', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
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

  // List extensions
  fastify.get('/platform/admin/extensions', { preHandler: [requirePlatformAdmin] }, async () => {
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
  fastify.post('/platform/admin/extensions/:name', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    if (!isValidIdentifier(name)) throw new BadRequestError('Invalid extension name');
    await fastify.db.query(`CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(name)}`);
    return { message: `Extension '${name}' enabled` };
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

  // ============================================================
  // Project-scoped admin routes
  // ============================================================

  // List tables in project schema
  fastify.get('/platform/projects/:projectRef/admin/tables', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const project = request.project!;
    const tables = await introspectSchema(fastify.db, project.schemaName);
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

  // Get table details in project schema
  fastify.get('/platform/projects/:projectRef/admin/tables/:table', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string; projectRef: string };
    const project = request.project!;
    const tables = await introspectSchema(fastify.db, project.schemaName);
    const info = tables.get(table);
    if (!info) throw new NotFoundError(`Table '${table}' not found in project`);

    const countResult = await fastify.db.query(
      `SELECT count(*)::int AS count FROM ${quoteQualifiedIdentifier(project.schemaName, table)}`,
    );

    return {
      ...info,
      rowCount: countResult.rows[0]?.count ?? 0,
    };
  });

  // Get table rows in project schema (admin access, bypasses RLS)
  fastify.get('/platform/projects/:projectRef/admin/tables/:table/rows', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string; projectRef: string };
    const project = request.project!;
    const tables = await introspectSchema(fastify.db, project.schemaName);
    const info = tables.get(table);
    if (!info) throw new NotFoundError(`Table '${table}' not found in project`);

    const query = request.query as Record<string, string>;
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 1000);
    const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);

    const qualifiedName = quoteQualifiedIdentifier(project.schemaName, table);
    const [dataResult, countResult] = await Promise.all([
      fastify.db.query(`SELECT * FROM ${qualifiedName} LIMIT $1 OFFSET $2`, [limit, offset]),
      fastify.db.query(`SELECT count(*)::int AS count FROM ${qualifiedName}`),
    ]);

    return {
      data: dataResult.rows,
      count: countResult.rows[0]?.count ?? 0,
      limit,
      offset,
    };
  });

  // Create table in project schema
  fastify.post('/platform/projects/:projectRef/admin/tables', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const project = request.project!;
    const body = createTableSchema.parse(request.body);

    if (!isValidIdentifier(body.name)) throw new BadRequestError('Invalid table name');

    const qualifiedName = quoteQualifiedIdentifier(project.schemaName, body.name);
    const columnDefs = body.columns.map((col) => {
      if (!isValidIdentifier(col.name)) throw new BadRequestError(`Invalid column name: ${col.name}`);
      const validatedType = validateColumnType(col.type);
      let def = `${quoteIdentifier(col.name)} ${validatedType}`;
      if (col.primaryKey) def += ' PRIMARY KEY';
      if (!col.nullable) def += ' NOT NULL';
      if (col.defaultValue) {
        const validatedDefault = validateDefaultValue(col.defaultValue);
        def += ` DEFAULT ${validatedDefault}`;
      }
      return def;
    });

    const sql = `CREATE TABLE ${qualifiedName} (\n  ${columnDefs.join(',\n  ')}\n)`;
    await fastify.db.query(sql);

    if (body.enableRls) {
      await fastify.db.query(`ALTER TABLE ${qualifiedName} ENABLE ROW LEVEL SECURITY`);
      await fastify.db.query(`ALTER TABLE ${qualifiedName} FORCE ROW LEVEL SECURITY`);
    }

    await fastify.db.query(`GRANT SELECT ON ${qualifiedName} TO anon`);
    await fastify.db.query(`GRANT ALL ON ${qualifiedName} TO authenticated`);
    await fastify.db.query(`GRANT ALL ON ${qualifiedName} TO service_role`);

    invalidateCache(project.schemaName);
    reply.status(201);
    return { message: `Table ${project.schemaName}.${body.name} created`, sql };
  });

  // Drop table in project schema
  fastify.delete('/platform/projects/:projectRef/admin/tables/:table', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string; projectRef: string };
    const project = request.project!;

    if (!isValidIdentifier(table)) {
      throw new BadRequestError('Invalid table name');
    }

    await fastify.db.query(`DROP TABLE ${quoteQualifiedIdentifier(project.schemaName, table)} CASCADE`);
    invalidateCache(project.schemaName);

    return { message: `Table ${project.schemaName}.${table} dropped` };
  });

  // Execute SQL in project schema context
  fastify.post('/platform/projects/:projectRef/admin/sql', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const project = request.project!;
    const body = sqlQuerySchema.parse(request.body);
    const startTime = Date.now();

    try {
      const client = await fastify.db.connect();
      try {
        await client.query('SET statement_timeout = 30000');
        await client.query(`SET search_path TO ${quoteIdentifier(project.schemaName)}, public`);
        var result = await client.query(body.query);
      } finally {
        await client.query('RESET statement_timeout');
        await client.query('RESET search_path');
        client.release();
      }
      const duration = Date.now() - startTime;
      invalidateCache(project.schemaName);

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

  // List project end-users
  fastify.get('/platform/projects/:projectRef/admin/users', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const project = request.project!;
    const query = request.query as { search?: string; limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 100);
    const offset = parseInt(query.offset ?? '0', 10);

    const usersTable = quoteQualifiedIdentifier(project.schemaName, 'users');
    let sql = `SELECT id, email, role, email_confirmed, is_disabled, created_at, updated_at, last_sign_in_at FROM ${usersTable}`;
    const values: unknown[] = [];

    if (query.search) {
      sql += ' WHERE email ILIKE $1';
      values.push(`%${query.search}%`);
    }

    sql += ' ORDER BY created_at DESC';
    sql += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const client = await fastify.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE service_role');
      const result = await client.query(sql, values);

      let countSql = `SELECT count(*)::int AS count FROM ${usersTable}`;
      const countValues: unknown[] = [];
      if (query.search) {
        countSql += ' WHERE email ILIKE $1';
        countValues.push(`%${query.search}%`);
      }
      const countResult = await client.query(countSql, countValues);

      await client.query('COMMIT');

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
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  // Update a project end-user
  fastify.patch('/platform/projects/:projectRef/admin/users/:id', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string; projectRef: string };
    const project = request.project!;
    const body = request.body as { role?: string; isDisabled?: boolean };

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.role !== undefined) {
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

    const usersTable = quoteQualifiedIdentifier(project.schemaName, 'users');
    const sql = `UPDATE ${usersTable} SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, email, role, is_disabled, updated_at`;

    const client = await fastify.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE service_role');
      const result = await client.query(sql, values);
      await client.query('COMMIT');

      if (result.rows.length === 0) throw new NotFoundError('User not found');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  // Delete a project end-user
  fastify.delete('/platform/projects/:projectRef/admin/users/:id', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string; projectRef: string };
    const project = request.project!;

    const usersTable = quoteQualifiedIdentifier(project.schemaName, 'users');

    const client = await fastify.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE service_role');
      const result = await client.query(
        `DELETE FROM ${usersTable} WHERE id = $1 RETURNING id`,
        [id],
      );
      await client.query('COMMIT');

      if (result.rows.length === 0) throw new NotFoundError('User not found');
      return { message: 'User deleted' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  // Refresh schema cache for project
  fastify.post('/platform/projects/:projectRef/admin/schema/refresh', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const project = request.project!;
    invalidateCache(project.schemaName);
    const tables = await introspectSchema(fastify.db, project.schemaName);
    return { message: 'Schema cache refreshed', tableCount: tables.size };
  });
};

export default adminPlugin;
