import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { resolveLocalProject } from '../../hooks/resolve-project.js';
import { introspectSchema, invalidateCache } from '../introspection/inspector.js';
import { quoteIdentifier, isValidIdentifier } from '../../lib/sql-helpers.js';
import { validateColumnType, validateDefaultValue } from '../../lib/sql-types.js';
import { z } from 'zod';
import { BadRequestError, NotFoundError, AppError } from '../../lib/errors.js';
import { readFile, writeFile, mkdir, readdir, access, unlink, stat, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { preprocessMigrationSql } from '../../lib/sql-preprocessor.js';
import { createRequire } from 'node:module';
import { unzipSync } from 'fflate';

const require = createRequire(import.meta.url);
const archiver = require('archiver') as typeof import('archiver');

function getMigrationsBase(): string {
  const dir = process.env.TOPHBASE_MIGRATIONS_DIR;
  if (!dir) throw new Error('TOPHBASE_MIGRATIONS_DIR is not set — run "tophbase freshman" first');
  return dir;
}

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

const createMigrationSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_.-]+\.sql$/, 'Invalid filename'),
  content: z.string().min(1).max(1_000_000),
  description: z.string().optional(),
});

const applyMigrationsSchema = z.object({
  names: z.array(z.string()).min(1),
});

async function ensureMigrationsTable(db: { query: (sql: string, values?: unknown[]) => Promise<unknown> }): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS auth._local_migrations (
      name TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      applied_at TIMESTAMPTZ,
      error_message TEXT
    )
  `);
}

const localAdminPlugin: FastifyPluginAsync = async (fastify) => {

  // ── Tables ──────────────────────────────────────────────────────────────

  fastify.get('/admin/tables', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const projectDb = request.projectDb!;
    const tables = await introspectSchema(projectDb, 'public', 'local');
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

  fastify.post('/admin/tables', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectDb = request.projectDb!;
    const body = createTableSchema.parse(request.body);

    if (!isValidIdentifier(body.name)) throw new BadRequestError('Invalid table name');

    const tableName = quoteIdentifier(body.name);
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

    const sql = `CREATE TABLE ${tableName} (\n  ${columnDefs.join(',\n  ')}\n)`;
    await projectDb.query(sql);

    if (body.enableRls) {
      await projectDb.query(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
      await projectDb.query(`ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY`);
    }

    await projectDb.query(`GRANT SELECT ON ${tableName} TO anon`);
    await projectDb.query(`GRANT ALL ON ${tableName} TO authenticated`);
    await projectDb.query(`GRANT ALL ON ${tableName} TO service_role`);

    invalidateCache('local');

    reply.status(201);
    return { message: `Table ${body.name} created`, sql };
  });

  fastify.get('/admin/tables/:table', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string };
    const projectDb = request.projectDb!;
    const tables = await introspectSchema(projectDb, 'public', 'local');
    const info = tables.get(table);
    if (!info) throw new NotFoundError(`Table '${table}' not found`);

    const countResult = await projectDb.query(
      `SELECT count(*)::int AS count FROM ${quoteIdentifier(table)}`,
    );
    return { ...info, rowCount: countResult.rows[0]?.count ?? 0 };
  });

  fastify.get('/admin/tables/:table/rows', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string };
    const projectDb = request.projectDb!;
    const tables = await introspectSchema(projectDb, 'public', 'local');
    if (!tables.has(table)) throw new NotFoundError(`Table '${table}' not found`);

    const query = request.query as Record<string, string>;
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 1000);
    const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);

    const tableName = quoteIdentifier(table);
    const [dataResult, countResult] = await Promise.all([
      projectDb.query(`SELECT * FROM ${tableName} LIMIT $1 OFFSET $2`, [limit, offset]),
      projectDb.query(`SELECT count(*)::int AS count FROM ${tableName}`),
    ]);

    return {
      data: dataResult.rows,
      count: countResult.rows[0]?.count ?? 0,
      limit,
      offset,
    };
  });

  fastify.delete('/admin/tables/:table', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const { table } = request.params as { table: string };
    const projectDb = request.projectDb!;
    if (!isValidIdentifier(table)) throw new BadRequestError('Invalid table name');
    await projectDb.query(`DROP TABLE ${quoteIdentifier(table)} CASCADE`);
    invalidateCache('local');
    return { message: `Table ${table} dropped` };
  });

  // ── Migrations ───────────────────────────────────────────────────────────

  fastify.get('/admin/migrations', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const projectDb = request.projectDb!;
    await ensureMigrationsTable(projectDb);
    await mkdir(getMigrationsBase(), { recursive: true });

    const files = (await readdir(getMigrationsBase())).filter(f => f.endsWith('.sql')).sort();

    const { rows: dbRows } = await projectDb.query<{
      name: string; status: string; applied_at: Date | null; error_message: string | null;
    }>('SELECT name, status, applied_at, error_message FROM auth._local_migrations ORDER BY name');

    const statusMap = new Map(dbRows.map(r => [r.name, r]));
    const migrations = files.map(name => {
      const rec = statusMap.get(name);
      return { name, status: rec?.status ?? 'pending', appliedAt: rec?.applied_at ?? null, errorMessage: rec?.error_message ?? null };
    });

    return { data: migrations, pendingCount: migrations.filter(m => m.status === 'pending').length };
  });

  fastify.post('/admin/migrations', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const projectDb = request.projectDb!;
    await ensureMigrationsTable(projectDb);
    await mkdir(getMigrationsBase(), { recursive: true });

    const body = createMigrationSchema.parse(request.body);
    const filePath = join(getMigrationsBase(), body.name);

    try {
      await access(filePath);
      throw new BadRequestError('Migration file already exists');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const content = body.description ? `-- ${body.description}\n\n${body.content}` : body.content;
    await writeFile(filePath, content, 'utf-8');

    await projectDb.query(
      `INSERT INTO auth._local_migrations (name, status) VALUES ($1, 'pending')`,
      [body.name],
    );

    return { message: 'Migration created successfully', migration: { name: body.name, status: 'pending' } };
  });

  fastify.post('/admin/migrations/apply', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const projectDb = request.projectDb!;
    await ensureMigrationsTable(projectDb);

    const body = applyMigrationsSchema.parse(request.body);
    const applied: string[] = [];
    const failed: { name: string; error: string }[] = [];

    for (const name of body.names.sort()) {
      if (!/^[a-zA-Z0-9_.-]+\.sql$/.test(name)) {
        failed.push({ name, error: 'Invalid filename' });
        continue;
      }

      const { rows: existing } = await projectDb.query<{ status: string }>(
        'SELECT status FROM auth._local_migrations WHERE name = $1',
        [name],
      );
      if (existing[0]?.status === 'applied') {
        failed.push({ name, error: 'Migration already applied' });
        continue;
      }

      const filePath = join(getMigrationsBase(), name);
      let sql: string;
      try {
        sql = await readFile(filePath, 'utf-8');
      } catch {
        failed.push({ name, error: 'File not found' });
        continue;
      }

      try {
        const startTime = Date.now();
        await projectDb.exec(`BEGIN;\n${preprocessMigrationSql(sql)}\nCOMMIT;`);
        const duration = Date.now() - startTime;

        await projectDb.query(
          `INSERT INTO auth._local_migrations (name, status, applied_at)
           VALUES ($1, 'applied', now())
           ON CONFLICT (name) DO UPDATE SET status = 'applied', applied_at = now(), error_message = NULL`,
          [name],
        );

        invalidateCache('local');
        applied.push(name);
        fastify.log.info({ name, duration }, 'Migration applied');
      } catch (error: unknown) {
        await projectDb.exec('ROLLBACK').catch(() => {});
        const msg = (error as Error).message;

        await projectDb.query(
          `INSERT INTO auth._local_migrations (name, status, error_message)
           VALUES ($1, 'failed', $2)
           ON CONFLICT (name) DO UPDATE SET status = 'failed', error_message = $2`,
          [name, msg],
        );

        failed.push({ name, error: msg });
        fastify.log.error({ name, error: msg }, 'Migration failed');
      }
    }

    return { applied, failed };
  });

  fastify.get('/admin/migrations/:name', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const projectDb = request.projectDb!;
    await ensureMigrationsTable(projectDb);

    if (!/^[a-zA-Z0-9_.-]+\.sql$/.test(name)) throw new BadRequestError('Invalid migration filename');

    const filePath = join(getMigrationsBase(), name);
    try {
      const content = await readFile(filePath, 'utf-8');
      const { rows } = await projectDb.query<{ status: string; applied_at: Date | null; error_message: string | null }>(
        'SELECT status, applied_at, error_message FROM auth._local_migrations WHERE name = $1',
        [name],
      );
      return { name, content, status: rows[0]?.status ?? 'pending', appliedAt: rows[0]?.applied_at ?? null, errorMessage: rows[0]?.error_message ?? null };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError('Migration file not found');
      throw error;
    }
  });

  fastify.delete('/admin/migrations/:name', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const projectDb = request.projectDb!;
    await ensureMigrationsTable(projectDb);

    if (!/^[a-zA-Z0-9_.-]+\.sql$/.test(name)) throw new BadRequestError('Invalid migration filename');

    const { rows } = await projectDb.query<{ status: string }>(
      'SELECT status FROM auth._local_migrations WHERE name = $1',
      [name],
    );
    if (rows[0]?.status === 'applied') throw new BadRequestError('Cannot delete applied migration');

    const filePath = join(getMigrationsBase(), name);
    await unlink(filePath);
    await projectDb.query('DELETE FROM auth._local_migrations WHERE name = $1', [name]);

    return { message: 'Migration deleted successfully' };
  });

  fastify.get('/admin/migrations/download', { preHandler: [resolveLocalProject] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    await mkdir(getMigrationsBase(), { recursive: true });
    const files = (await readdir(getMigrationsBase())).filter(f => f.endsWith('.sql')).sort();
    if (files.length === 0) throw new NotFoundError('No migrations found');

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', 'attachment; filename="migrations.zip"');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(reply.raw);

    for (const file of files) {
      const content = await readFile(join(getMigrationsBase(), file), 'utf-8');
      archive.append(content, { name: file });
    }

    await archive.finalize();
    return reply;
  });

  fastify.post('/admin/migrations/upload', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const projectDb = request.projectDb!;
    await ensureMigrationsTable(projectDb);
    await mkdir(getMigrationsBase(), { recursive: true });

    let replace = false;
    const sqlFiles: { name: string; content: string }[] = [];

    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'replace' && (part as unknown as { value: string }).value === 'true') replace = true;
        continue;
      }

      const filePart = part as unknown as { filename?: string; toBuffer: () => Promise<Buffer> };
      const buffer = await filePart.toBuffer();
      const filename = filePart.filename ?? '';

      if (filename.endsWith('.zip')) {
        let unzipped: ReturnType<typeof unzipSync>;
        try { unzipped = unzipSync(buffer); } catch { throw new BadRequestError('Invalid or corrupt zip file'); }
        for (const [p, data] of Object.entries(unzipped)) {
          const basename = p.split('/').pop() ?? p;
          if (!basename.endsWith('.sql') || !/^[a-zA-Z0-9_.-]+\.sql$/.test(basename)) continue;
          sqlFiles.push({ name: basename, content: new TextDecoder().decode(data) });
        }
      } else if (filename.endsWith('.sql')) {
        const name = filename.split('/').pop() ?? filename;
        if (!/^[a-zA-Z0-9_.-]+\.sql$/.test(name)) throw new BadRequestError(`Invalid filename: ${name}`);
        sqlFiles.push({ name, content: buffer.toString('utf-8') });
      }
    }

    if (sqlFiles.length === 0) throw new BadRequestError('No valid .sql files found in upload');

    const deduped = new Map<string, string>();
    for (const f of sqlFiles) deduped.set(f.name, f.content);
    const files = Array.from(deduped.entries()).map(([name, content]) => ({ name, content }));

    const collisions: { name: string; status: string }[] = [];
    for (const file of files) {
      try { await access(join(getMigrationsBase(), file.name)); } catch { continue; }
      const { rows } = await projectDb.query<{ status: string }>(
        'SELECT status FROM auth._local_migrations WHERE name = $1', [file.name],
      );
      collisions.push({ name: file.name, status: rows[0]?.status ?? 'pending' });
    }

    const appliedCollisions = collisions.filter(c => c.status === 'applied');
    if (appliedCollisions.length > 0) {
      throw new AppError(409, 'APPLIED_COLLISION',
        `${appliedCollisions.length} migration(s) have already been applied and cannot be replaced`,
        { collisions },
      );
    }
    if (collisions.length > 0 && !replace) {
      throw new AppError(409, 'PENDING_COLLISION', `${collisions.length} migration(s) already exist`, { collisions });
    }

    const imported: string[] = [];
    const replaced: string[] = [];

    for (const file of files) {
      await writeFile(join(getMigrationsBase(), file.name), file.content, 'utf-8');
      const isCollision = collisions.find(c => c.name === file.name);
      if (isCollision) {
        await projectDb.query(
          `UPDATE auth._local_migrations SET status = 'pending', applied_at = NULL, error_message = NULL WHERE name = $1`,
          [file.name],
        );
        replaced.push(file.name);
      } else {
        await projectDb.query(
          `INSERT INTO auth._local_migrations (name, status) VALUES ($1, 'pending')
           ON CONFLICT (name) DO UPDATE SET status = 'pending', applied_at = NULL, error_message = NULL`,
          [file.name],
        );
        imported.push(file.name);
      }
    }

    return {
      message: `Imported ${imported.length} migration(s)${replaced.length > 0 ? `, replaced ${replaced.length}` : ''}`,
      imported,
      replaced,
    };
  });

  // ── Users ────────────────────────────────────────────────────────────────

  fastify.get('/admin/users', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const projectDb = request.projectDb!;
    const query = request.query as { search?: string; limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 100);
    const offset = parseInt(query.offset ?? '0', 10);

    let sql = `SELECT id, email, role, email_confirmed, is_disabled, created_at, updated_at, last_sign_in_at FROM auth.users`;
    const values: unknown[] = [];

    if (query.search) {
      sql += ' WHERE email ILIKE $1';
      values.push(`%${query.search}%`);
    }

    sql += ' ORDER BY created_at DESC';
    sql += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const result = await projectDb.query(sql, values);

    let countSql = 'SELECT count(*)::int AS count FROM auth.users';
    const countValues: unknown[] = [];
    if (query.search) {
      countSql += ' WHERE email ILIKE $1';
      countValues.push(`%${query.search}%`);
    }
    const countResult = await projectDb.query(countSql, countValues);

    return {
      data: result.rows.map((u: Record<string, unknown>) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        emailConfirmed: u.email_confirmed,
        isDisabled: u.is_disabled,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
        lastSignInAt: u.last_sign_in_at,
      })),
      count: (countResult.rows[0] as Record<string, unknown>)?.count ?? 0,
      limit,
      offset,
    };
  });

  fastify.post('/admin/users', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectDb = request.projectDb!;
    const body = request.body as { email: string; password: string; emailConfirmed?: boolean };

    if (!body.email || !body.password) throw new BadRequestError('Email and password are required');
    if (body.password.length < 8) throw new BadRequestError('Password must be at least 8 characters');

    const existing = await projectDb.query('SELECT id FROM auth.users WHERE email = $1', [body.email]);
    if (existing.rows.length > 0) {
      reply.status(409).send({ error: { code: 'CONFLICT', message: 'User with this email already exists' } });
      return;
    }

    const { hashPassword } = await import('../auth/password.js');
    const passwordHash = await hashPassword(body.password);

    const result = await projectDb.query(
      `INSERT INTO auth.users (email, password_hash, role, email_confirmed)
       VALUES ($1, $2, 'authenticated', $3)
       RETURNING id, email, role, email_confirmed, is_disabled, created_at, updated_at`,
      [body.email, passwordHash, body.emailConfirmed ?? false],
    );

    const user = result.rows[0] as Record<string, unknown>;
    reply.status(201).send({
      id: user.id,
      email: user.email,
      role: user.role,
      emailConfirmed: user.email_confirmed,
      isDisabled: user.is_disabled,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      lastSignInAt: null,
    });
  });

  fastify.patch('/admin/users/:id', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const projectDb = request.projectDb!;
    const body = request.body as { role?: string; isDisabled?: boolean; password?: string };

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
    if (body.password !== undefined) {
      if (body.password.length < 8) throw new BadRequestError('Password must be at least 8 characters');
      const { hashPassword } = await import('../auth/password.js');
      updates.push(`password_hash = $${paramIndex++}`);
      values.push(await hashPassword(body.password));
    }

    if (updates.length === 0) throw new BadRequestError('No fields to update');

    updates.push('updated_at = now()');
    values.push(id);

    const sql = `UPDATE auth.users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, email, role, is_disabled, updated_at`;
    const result = await projectDb.query(sql, values);

    if (result.rows.length === 0) throw new NotFoundError('User not found');
    return result.rows[0];
  });

  fastify.delete('/admin/users/:id', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const projectDb = request.projectDb!;
    const result = await projectDb.query('DELETE FROM auth.users WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) throw new NotFoundError('User not found');
    return { message: 'User deleted' };
  });

  // ── DB Reset ─────────────────────────────────────────────────────────────

  fastify.post('/admin/db/reset', { preHandler: [resolveLocalProject] }, async (request: FastifyRequest) => {
    const projectDb = request.projectDb!;
    const body = request.body as { includeAuth?: boolean };

    // Drop all user tables in the public schema
    const { rows: tables } = await projectDb.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );

    for (const { tablename } of tables) {
      await projectDb.exec(`DROP TABLE IF EXISTS public.${quoteIdentifier(tablename)} CASCADE`);
    }

    // Drop all views in the public schema
    const { rows: views } = await projectDb.query<{ viewname: string }>(
      `SELECT viewname FROM pg_views WHERE schemaname = 'public'`,
    );
    for (const { viewname } of views) {
      await projectDb.exec(`DROP VIEW IF EXISTS public.${quoteIdentifier(viewname)} CASCADE`);
    }

    // Reset migration tracking
    try {
      await projectDb.query(`DELETE FROM auth._local_migrations`);
    } catch {
      // Table may not exist yet — ignore
    }

    if (body.includeAuth) {
      await projectDb.query(`DELETE FROM auth.sessions`);
      await projectDb.query(`DELETE FROM auth.users`);
    }

    invalidateCache('local');

    return {
      message: 'Database reset successfully',
      droppedTables: tables.map(t => t.tablename),
      authCleared: body.includeAuth ?? false,
    };
  });

  // ── Backup ───────────────────────────────────────────────────────────────

  fastify.get('/admin/backup', async (_request, reply) => {
    const { project } = fastify.config;
    const dataDir = project.dataDir;

    if (!fastify.db.dumpDataDir) {
      return reply.status(503).send({ error: { code: 'NOT_SUPPORTED', message: 'Backup not supported on this database backend' } });
    }
    const dbDump = await fastify.db.dumpDataDir();

    const [configJson, secretsJson] = await Promise.all([
      readFile(join(dataDir, 'config.json'), 'utf8').catch(() => '{}'),
      readFile(join(dataDir, 'secrets.json'), 'utf8').catch(() => '{}'),
    ]);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="tophbase-backup-${timestamp}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(reply.raw);

    const meta = JSON.stringify({
      version: '1',
      createdAt: new Date().toISOString(),
      tophbaseVersion: '0.1.0',
    }, null, 2);
    archive.append(meta, { name: 'backup-meta.json' });
    archive.append(configJson, { name: 'config.json' });
    archive.append(secretsJson, { name: 'secrets.json' });
    archive.append(dbDump, { name: 'db.tar.gz' });

    const storageDir = join(dataDir, 'storage');
    const storageExists = await stat(storageDir).then(s => s.isDirectory()).catch(() => false);
    if (storageExists) {
      archive.directory(storageDir, 'storage');
    }

    const migrationsDir = process.env.TOPHBASE_MIGRATIONS_DIR;
    if (migrationsDir) {
      const migrationsExist = await stat(migrationsDir).then(s => s.isDirectory()).catch(() => false);
      if (migrationsExist) {
        archive.directory(migrationsDir, 'migrations');
      }
    }

    await archive.finalize();
    return reply;
  });

  fastify.post('/admin/restore', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!fastify.db.restoreFromDump) {
      return reply.status(503).send({ error: { code: 'NOT_SUPPORTED', message: 'Restore not supported on this database backend' } });
    }

    let zipBuffer: Buffer | null = null;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        zipBuffer = await (part as unknown as { toBuffer: () => Promise<Buffer> }).toBuffer();
        break;
      }
    }
    if (!zipBuffer) throw new BadRequestError('No file uploaded');

    let unzipped: ReturnType<typeof unzipSync>;
    try {
      unzipped = unzipSync(zipBuffer);
    } catch {
      throw new BadRequestError('Invalid or corrupt zip file');
    }

    const metaRaw = unzipped['backup-meta.json'];
    if (!metaRaw) throw new BadRequestError('Not a valid Tophbase backup (missing backup-meta.json)');

    let meta: { version: string };
    try {
      meta = JSON.parse(new TextDecoder().decode(metaRaw)) as { version: string };
    } catch {
      throw new BadRequestError('Corrupt backup-meta.json');
    }
    if (meta.version !== '1') throw new BadRequestError(`Unsupported backup version: ${meta.version}`);

    const dbEntry = unzipped['db.tar.gz'];
    if (!dbEntry) throw new BadRequestError('Backup is missing db.tar.gz');

    const { project } = fastify.config;
    const dataDir = project.dataDir;
    const restored: string[] = [];

    await fastify.db.restoreFromDump(Buffer.from(dbEntry));
    restored.push('database');

    const configEntry = unzipped['config.json'];
    if (configEntry) {
      await writeFile(join(dataDir, 'config.json'), Buffer.from(configEntry));
      restored.push('config');
    }

    const secretsEntry = unzipped['secrets.json'];
    if (secretsEntry) {
      await writeFile(join(dataDir, 'secrets.json'), Buffer.from(secretsEntry));
      restored.push('secrets');
    }

    const storageEntries = Object.entries(unzipped).filter(([p]) => p.startsWith('storage/') && !p.endsWith('/'));
    if (storageEntries.length > 0) {
      const storageDir = join(dataDir, 'storage');
      await rm(storageDir, { recursive: true, force: true });
      for (const [p, data] of storageEntries) {
        const relPath = p.slice('storage/'.length);
        if (!relPath) continue;
        const filePath = join(storageDir, relPath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, Buffer.from(data));
      }
      restored.push('storage');
    }

    const migrationsDir = process.env.TOPHBASE_MIGRATIONS_DIR;
    const migrationEntries = Object.entries(unzipped).filter(([p]) => p.startsWith('migrations/') && p.endsWith('.sql'));
    if (migrationsDir && migrationEntries.length > 0) {
      await mkdir(migrationsDir, { recursive: true });
      for (const [p, data] of migrationEntries) {
        const filename = p.split('/').pop() ?? '';
        if (!/^[a-zA-Z0-9_.-]+\.sql$/.test(filename)) continue;
        await writeFile(join(migrationsDir, filename), Buffer.from(data));
      }
      restored.push('migrations');
    }

    invalidateCache('local');

    return { ok: true, restored };
  });
};

export default localAdminPlugin;
