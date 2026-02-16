import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { requirePlatformAdmin } from '../../hooks/authenticate.js';
import { createProjectResolver } from '../../hooks/resolve-project.js';
import { introspectSchema, invalidateCache } from '../introspection/inspector.js';
import { quoteIdentifier, quoteQualifiedIdentifier, isValidIdentifier } from '../../lib/sql-helpers.js';
import { validateColumnType, validateDefaultValue } from '../../lib/sql-types.js';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { readFile, writeFile, mkdir, readdir, access, unlink } from 'node:fs/promises';
import { join } from 'node:path';

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

const createMigrationSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_.-]+\.sql$/, 'Invalid filename'),
  content: z.string().min(1).max(1000000),
  description: z.string().optional(),
});

const applyMigrationsSchema = z.object({
  names: z.array(z.string()).min(1, 'At least one migration required'),
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

    // Notify PostgREST to reload schema cache
    await fastify.db.query(`NOTIFY pgrst, 'reload schema'`);

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

    // Notify PostgREST to reload schema cache
    await fastify.db.query(`NOTIFY pgrst, 'reload schema'`);

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

      // Notify PostgREST to reload schema cache (in case DDL was executed)
      await fastify.db.query(`NOTIFY pgrst, 'reload schema'`).catch(() => {
        // Ignore errors (e.g., if not in a transaction)
      });

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

  // ============================================================
  // Project migrations
  // ============================================================

  // List migrations
  fastify.get('/platform/projects/:projectRef/admin/migrations', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const project = request.project!;
    const projectMigrationsDir = join(process.cwd(), 'migrations', 'projects', project.ref);

    // Ensure project migrations directory exists
    await mkdir(projectMigrationsDir, { recursive: true });

    // Read migration files from disk
    const files = (await readdir(projectMigrationsDir))
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Get applied status from database
    const { rows: dbMigrations } = await fastify.db.query<{
      name: string;
      applied_at: Date | null;
      status: string;
      error_message: string | null;
    }>(
      `SELECT name, applied_at, status, error_message
       FROM toph_internal.migrations
       WHERE project_id = $1
       ORDER BY name`,
      [project.id]
    );

    const statusMap = new Map(dbMigrations.map(m => [m.name, m]));

    // Merge file list with database status
    const migrations = files.map(name => {
      const dbRecord = statusMap.get(name);
      return {
        name,
        status: dbRecord?.status || 'pending',
        appliedAt: dbRecord?.applied_at || null,
        errorMessage: dbRecord?.error_message || null,
      };
    });

    const pendingCount = migrations.filter(m => m.status === 'pending').length;

    return { data: migrations, pendingCount };
  });

  // Get migration content
  fastify.get('/platform/projects/:projectRef/admin/migrations/:name', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const project = request.project!;

    // Security: validate filename (prevent path traversal)
    if (!/^[a-zA-Z0-9_.-]+\.sql$/.test(name)) {
      throw new BadRequestError('Invalid migration filename');
    }

    const filePath = join(process.cwd(), 'migrations', 'projects', project.ref, name);

    try {
      const content = await readFile(filePath, 'utf-8');
      const { rows } = await fastify.db.query(
        'SELECT status, applied_at, error_message FROM toph_internal.migrations WHERE name = $1 AND project_id = $2',
        [name, project.id]
      );

      return {
        name,
        content,
        status: rows[0]?.status || 'pending',
        appliedAt: rows[0]?.applied_at || null,
        errorMessage: rows[0]?.error_message || null,
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new NotFoundError('Migration file not found');
      }
      throw error;
    }
  });

  // Create migration
  fastify.post('/platform/projects/:projectRef/admin/migrations', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const body = createMigrationSchema.parse(request.body);
    const project = request.project!;

    const projectMigrationsDir = join(process.cwd(), 'migrations', 'projects', project.ref);
    await mkdir(projectMigrationsDir, { recursive: true });

    const filePath = join(projectMigrationsDir, body.name);

    // Check if file already exists
    try {
      await access(filePath);
      throw new BadRequestError('Migration file already exists');
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }

    // Add comment header with description if provided
    const content = body.description
      ? `-- ${body.description}\n\n${body.content}`
      : body.content;

    // Write file to disk
    await writeFile(filePath, content, 'utf-8');

    // Create pending record in database
    await fastify.db.query(
      `INSERT INTO toph_internal.migrations (name, project_id, status)
       VALUES ($1, $2, 'pending')`,
      [body.name, project.id]
    );

    return {
      message: 'Migration created successfully',
      migration: { name: body.name, status: 'pending' }
    };
  });

  // Apply selected migrations
  fastify.post('/platform/projects/:projectRef/admin/migrations/apply', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const body = applyMigrationsSchema.parse(request.body);
    const project = request.project!;

    const applied: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    // Sort migrations to apply in order
    const sortedNames = body.names.sort();

    for (const name of sortedNames) {
      // Validate filename
      if (!/^[a-zA-Z0-9_.-]+\.sql$/.test(name)) {
        failed.push({ name, error: 'Invalid filename' });
        continue;
      }

      // Check if already applied
      const { rows: existing } = await fastify.db.query(
        'SELECT status FROM toph_internal.migrations WHERE name = $1 AND project_id = $2',
        [name, project.id]
      );

      if (existing[0]?.status === 'applied') {
        failed.push({ name, error: 'Migration already applied' });
        continue;
      }

      // Read migration file
      const filePath = join(process.cwd(), 'migrations', 'projects', project.ref, name);
      let sql: string;

      try {
        sql = await readFile(filePath, 'utf-8');
      } catch (error: any) {
        failed.push({ name, error: 'File not found' });
        continue;
      }

      // Apply migration in transaction
      const client = await fastify.db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE service_role');
        await client.query(`SET search_path TO ${quoteIdentifier(project.schemaName)}, public`);

        const startTime = Date.now();
        await client.query(sql);
        const duration = Date.now() - startTime;

        // Update status to applied
        await client.query(
          `UPDATE toph_internal.migrations
           SET status = 'applied', applied_at = now(), applied_by = $1, error_message = NULL
           WHERE name = $2 AND project_id = $3`,
          [request.platformPayload?.sub, name, project.id]
        );

        await client.query('COMMIT');
        invalidateCache(project.schemaName);
        await fastify.db.query(`NOTIFY pgrst, 'reload schema'`);

        applied.push(name);

        fastify.log.info({ name, duration, project: project.ref }, 'Migration applied');
      } catch (error: any) {
        await client.query('ROLLBACK');

        // Update status to failed
        await fastify.db.query(
          `INSERT INTO toph_internal.migrations (name, project_id, status, error_message)
           VALUES ($1, $2, 'failed', $3)
           ON CONFLICT (name, project_id) DO UPDATE SET status = 'failed', error_message = $3`,
          [name, project.id, error.message]
        );

        failed.push({ name, error: error.message });

        fastify.log.error({ name, error: error.message, project: project.ref }, 'Migration failed');
      } finally {
        client.release();
      }
    }

    return { applied, failed };
  });

  // Delete pending migration
  fastify.delete('/platform/projects/:projectRef/admin/migrations/:name', {
    preHandler: [requirePlatformAdmin, resolveProject],
  }, async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const project = request.project!;

    if (!/^[a-zA-Z0-9_.-]+\.sql$/.test(name)) {
      throw new BadRequestError('Invalid migration filename');
    }

    // Check status - only allow deleting pending migrations
    const { rows } = await fastify.db.query(
      'SELECT status FROM toph_internal.migrations WHERE name = $1 AND project_id = $2',
      [name, project.id]
    );

    if (rows[0]?.status === 'applied') {
      throw new BadRequestError('Cannot delete applied migration');
    }

    // Delete file
    const filePath = join(process.cwd(), 'migrations', 'projects', project.ref, name);
    await unlink(filePath);

    // Delete database record
    await fastify.db.query(
      'DELETE FROM toph_internal.migrations WHERE name = $1 AND project_id = $2',
      [name, project.id]
    );

    return { message: 'Migration deleted successfully' };
  });
};

export default adminPlugin;
