import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { requirePlatformAdmin } from '../../hooks/authenticate.js';
import {
  generateProjectJwtSecret,
  generateApiKey,
  generatePublishableKey,
  generateSecretKey
} from '../auth/jwt.js';
import { invalidateProjectCache } from '../../hooks/resolve-project.js';
import { isValidIdentifier, quoteIdentifier } from '../../lib/sql-helpers.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { z } from 'zod';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  ref: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Ref must be lowercase alphanumeric with hyphens').min(3).max(32).optional(),
  postgrestUrl: z.string().url().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.enum(['active', 'paused']).optional(),
  postgrestUrl: z.string().url().optional(),
});

function generateRef(): string {
  return crypto.randomBytes(4).toString('hex');
}

const projectsPlugin: FastifyPluginAsync = async (fastify) => {
  const poolManager = fastify.projectPoolManager;

  // List projects for authenticated platform user
  fastify.get('/platform/projects', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const userId = request.platformUserId!;
    const result = await fastify.db.query(
      `SELECT p.id, p.ref, p.name, p.db_name, p.status, p.created_at, p.updated_at, pm.role AS member_role
       FROM toph_internal.projects p
       JOIN toph_internal.project_members pm ON p.id = pm.project_id
       WHERE pm.user_id = $1 AND p.status != 'deleted'
       ORDER BY p.created_at DESC`,
      [userId],
    );

    return result.rows.map(r => ({
      id: r.id,
      ref: r.ref,
      name: r.name,
      dbName: r.db_name,
      status: r.status,
      memberRole: r.member_role,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });

  // Get project details
  fastify.get('/platform/projects/:ref', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const { ref } = request.params as { ref: string };
    const userId = request.platformUserId!;

    const result = await fastify.db.query(
      `SELECT p.*, pm.role AS member_role
       FROM toph_internal.projects p
       JOIN toph_internal.project_members pm ON p.id = pm.project_id
       WHERE p.ref = $1 AND pm.user_id = $2 AND p.status != 'deleted'`,
      [ref, userId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError(`Project '${ref}' not found`);
    }

    const p = result.rows[0];

    // Get default new format keys (first active publishable and secret)
    const keysResult = await fastify.db.query(
      `SELECT key_prefix, key_value
       FROM toph_internal.api_keys
       WHERE project_id = $1 AND revoked_at IS NULL
       ORDER BY created_at ASC`,
      [p.id],
    );

    const publishableKey = keysResult.rows.find(k => k.key_prefix === 'publishable')?.key_value;
    const secretKey = keysResult.rows.find(k => k.key_prefix === 'secret')?.key_value;

    // Get PostgREST health status if configured
    const postgrestHealth = p.postgrest_url ? fastify.postgrestManager.getHealth(p.ref) : undefined;

    return {
      id: p.id,
      ref: p.ref,
      name: p.name,
      dbName: p.db_name,
      jwtSecret: p.jwt_secret,
      status: p.status,
      publishableKey,
      secretKey,
      postgrestUrl: p.postgrest_url,
      postgrestHealth: postgrestHealth ?? null,
      settings: p.settings,
      memberRole: p.member_role,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  });

  // Create project
  fastify.post('/platform/projects', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createProjectSchema.parse(request.body);
    const userId = request.platformUserId!;

    const ref = body.ref ?? generateRef();
    const dbName = `toph_proj_${ref.replace(/-/g, '_')}`;

    if (!isValidIdentifier(dbName)) {
      throw new BadRequestError('Generated database name is invalid. Try a different project ref.');
    }

    // Check uniqueness
    const existing = await fastify.db.query(
      'SELECT id FROM toph_internal.projects WHERE ref = $1',
      [ref],
    );
    if (existing.rows.length > 0) {
      throw new BadRequestError(`Project ref '${ref}' is already taken`);
    }

    const jwtSecret = generateProjectJwtSecret();
    const publishableKey = generatePublishableKey();
    const secretKey = generateSecretKey();

    // Insert project record in platform DB
    const client = await fastify.db.connect();
    let project: any;
    try {
      await client.query('BEGIN');

      const insertResult = await client.query(
        `INSERT INTO toph_internal.projects (ref, name, db_name, jwt_secret, postgrest_url, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, ref, name, db_name, status, created_at`,
        [ref, body.name, dbName, jwtSecret, body.postgrestUrl ?? null, userId],
      );

      project = insertResult.rows[0];

      await client.query(
        `INSERT INTO toph_internal.project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [project.id, userId],
      );

      // Create new format API keys
      await client.query(
        `INSERT INTO toph_internal.api_keys (project_id, key_value, key_prefix, role, name, created_by)
         VALUES ($1, $2, 'publishable', 'anon', 'Default publishable key', $3)`,
        [project.id, publishableKey, userId],
      );

      await client.query(
        `INSERT INTO toph_internal.api_keys (project_id, key_value, key_prefix, role, name, created_by)
         VALUES ($1, $2, 'secret', 'service_role', 'Default secret key', $3)`,
        [project.id, secretKey, userId],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    // CREATE DATABASE outside transaction (DDL can't be in a transaction)
    try {
      await fastify.db.query(`CREATE DATABASE ${quoteIdentifier(dbName)}`);

      // Initialize the project database with the template
      const templatePath = join(dirname(fileURLToPath(import.meta.url)), '../../../../../migrations', 'project-template.sql');
      const templateSql = await readFile(templatePath, 'utf-8');
      const projectPool = poolManager.getProjectPool(dbName);
      await projectPool.query(templateSql);
    } catch (error) {
      fastify.log.error({ error, dbName, ref }, 'Failed to provision project database');
      await fastify.db
        .query(
          `UPDATE toph_internal.projects SET status = 'provisioning_failed', updated_at = now() WHERE id = $1`,
          [project.id],
        )
        .catch((updateErr) => {
          fastify.log.error({ error: updateErr }, 'Failed to mark project as provisioning_failed');
        });
      const message = error instanceof Error ? error.message : 'Failed to provision project database';
      throw new BadRequestError(`Failed to provision project database: ${message}`);
    }

    // Register PostgREST instance if URL was provided
    if (body.postgrestUrl) {
      const isHealthy = await fastify.postgrestManager.registerInstance(ref, body.postgrestUrl);
      if (!isHealthy) {
        fastify.log.warn({ project: ref, url: body.postgrestUrl }, 'PostgREST instance not healthy at creation time');
      }
    }

    const postgrestHealth = body.postgrestUrl ? fastify.postgrestManager.getHealth(ref) : null;

    reply.status(201).send({
      id: project.id,
      ref: project.ref,
      name: project.name,
      dbName: project.db_name,
      status: project.status,
      publishableKey,
      secretKey,
      postgrestUrl: body.postgrestUrl ?? null,
      postgrestHealth,
      createdAt: project.created_at,
    });
  });

  // Update project
  fastify.patch('/platform/projects/:ref', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const { ref } = request.params as { ref: string };
    const body = updateProjectSchema.parse(request.body);
    const userId = request.platformUserId!;

    // Verify ownership
    const check = await fastify.db.query(
      `SELECT p.id FROM toph_internal.projects p
       JOIN toph_internal.project_members pm ON p.id = pm.project_id
       WHERE p.ref = $1 AND pm.user_id = $2 AND pm.role = 'owner' AND p.status != 'deleted'`,
      [ref, userId],
    );
    if (check.rows.length === 0) {
      throw new NotFoundError('Project not found or insufficient permissions');
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(body.name);
    }
    if (body.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(body.status);
    }
    if (body.postgrestUrl !== undefined) {
      updates.push(`postgrest_url = $${paramIndex++}`);
      values.push(body.postgrestUrl);
    }

    if (updates.length === 0) {
      throw new BadRequestError('No fields to update');
    }

    updates.push(`updated_at = now()`);
    values.push(ref);

    const result = await fastify.db.query(
      `UPDATE toph_internal.projects SET ${updates.join(', ')} WHERE ref = $${paramIndex} RETURNING id, ref, name, db_name, postgrest_url, status, updated_at`,
      values,
    );

    const proj = result.rows[0];

    // Handle PostgREST instance lifecycle based on changes
    if (body.postgrestUrl !== undefined) {
      if (body.postgrestUrl) {
        // URL was set or changed - register the new instance
        await fastify.postgrestManager.registerInstance(ref, body.postgrestUrl);
      } else {
        // URL was cleared - unregister
        fastify.postgrestManager.unregisterInstance(ref);
      }
    }

    if (body.status === 'paused') {
      // Unregister PostgREST instance when project is paused
      fastify.postgrestManager.unregisterInstance(ref);
    } else if (body.status === 'active' && proj.postgrest_url) {
      // Re-register when reactivating
      await fastify.postgrestManager.registerInstance(ref, proj.postgrest_url);
    }

    invalidateProjectCache(ref);
    return proj;
  });

  // Delete project
  fastify.delete('/platform/projects/:ref', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const { ref } = request.params as { ref: string };
    const userId = request.platformUserId!;

    const check = await fastify.db.query(
      `SELECT p.id, p.db_name FROM toph_internal.projects p
       JOIN toph_internal.project_members pm ON p.id = pm.project_id
       WHERE p.ref = $1 AND pm.user_id = $2 AND pm.role = 'owner' AND p.status != 'deleted'`,
      [ref, userId],
    );
    if (check.rows.length === 0) {
      throw new NotFoundError('Project not found or insufficient permissions');
    }

    const dbName = check.rows[0].db_name;

    await fastify.db.query(
      `UPDATE toph_internal.projects SET status = 'deleted', updated_at = now() WHERE ref = $1`,
      [ref],
    );

    // Close the project pool before dropping the database
    await poolManager.closeProjectPool(dbName);

    // Drop the project database
    try {
      await fastify.db.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(dbName)}`);
    } catch (error) {
      fastify.log.error({ error, dbName, ref }, 'Failed to drop project database');
    }

    // Unregister PostgREST instance
    fastify.postgrestManager.unregisterInstance(ref);

    invalidateProjectCache(ref);
    return { message: `Project '${ref}' deleted` };
  });

  // Regenerate API keys
  fastify.post('/platform/projects/:ref/regenerate-keys', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const { ref } = request.params as { ref: string };
    const userId = request.platformUserId!;

    const projectResult = await fastify.db.query(
      `SELECT p.id, p.jwt_secret FROM toph_internal.projects p
       JOIN toph_internal.project_members pm ON p.id = pm.project_id
       WHERE p.ref = $1 AND pm.user_id = $2 AND pm.role = 'owner' AND p.status != 'deleted'`,
      [ref, userId],
    );
    if (projectResult.rows.length === 0) {
      throw new NotFoundError('Project not found or insufficient permissions');
    }

    const projectId = projectResult.rows[0].id;

    // Revoke all existing keys for this project
    await fastify.db.query(
      `UPDATE toph_internal.api_keys SET revoked_at = now()
       WHERE project_id = $1 AND revoked_at IS NULL`,
      [projectId],
    );

    // Generate new keys
    const publishableKey = generatePublishableKey();
    const secretKey = generateSecretKey();

    // Insert new publishable key
    await fastify.db.query(
      `INSERT INTO toph_internal.api_keys (project_id, key_value, key_prefix, role, name, created_by)
       VALUES ($1, $2, 'publishable', 'anon', 'Regenerated publishable key', $3)`,
      [projectId, publishableKey, userId],
    );

    // Insert new secret key
    await fastify.db.query(
      `INSERT INTO toph_internal.api_keys (project_id, key_value, key_prefix, role, name, created_by)
       VALUES ($1, $2, 'secret', 'service_role', 'Regenerated secret key', $3)`,
      [projectId, secretKey, userId],
    );

    invalidateProjectCache(ref);

    return {
      publishableKey,
      secretKey,
      message: 'API keys regenerated. Previous keys have been revoked.',
    };
  });

  // Regenerate JWT secret (dangerous - invalidates all sessions and requires PostgREST restart)
  fastify.post('/platform/projects/:ref/regenerate-jwt-secret', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const { ref } = request.params as { ref: string };
    const userId = request.platformUserId!;

    // Verify ownership
    const check = await fastify.db.query(
      `SELECT p.id FROM toph_internal.projects p
       JOIN toph_internal.project_members pm ON p.id = pm.project_id
       WHERE p.ref = $1 AND pm.user_id = $2 AND pm.role = 'owner' AND p.status != 'deleted'`,
      [ref, userId],
    );
    if (check.rows.length === 0) {
      throw new NotFoundError('Project not found or insufficient permissions');
    }

    const newJwtSecret = generateProjectJwtSecret();

    const result = await fastify.db.query(
      `UPDATE toph_internal.projects
       SET jwt_secret = $1, updated_at = now()
       WHERE ref = $2
       RETURNING jwt_secret`,
      [newJwtSecret, ref],
    );

    invalidateProjectCache(ref);

    return {
      jwtSecret: result.rows[0].jwt_secret,
      message: 'JWT secret regenerated. All user sessions are now invalid. You must restart PostgREST with the new secret.',
    };
  });
};

export default projectsPlugin;
