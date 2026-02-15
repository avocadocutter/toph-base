import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { requirePlatformAdmin } from '../../hooks/authenticate.js';
import { generateProjectJwtSecret, generateApiKey } from '../auth/jwt.js';
import { invalidateProjectCache } from '../../hooks/resolve-project.js';
import { isValidIdentifier } from '../../lib/sql-helpers.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { z } from 'zod';
import crypto from 'node:crypto';

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  ref: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Ref must be lowercase alphanumeric with hyphens').min(3).max(32).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

function generateRef(): string {
  return crypto.randomBytes(4).toString('hex');
}

const projectsPlugin: FastifyPluginAsync = async (fastify) => {
  // List projects for authenticated platform user
  fastify.get('/platform/projects', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const userId = request.platformUserId!;
    const result = await fastify.db.query(
      `SELECT p.id, p.ref, p.name, p.schema_name, p.status, p.created_at, p.updated_at, pm.role AS member_role
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
      schemaName: r.schema_name,
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
    return {
      id: p.id,
      ref: p.ref,
      name: p.name,
      schemaName: p.schema_name,
      status: p.status,
      anonKey: p.anon_key,
      serviceRoleKey: p.service_role_key,
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
    const schemaName = `proj_${ref.replace(/-/g, '_')}`;

    if (!isValidIdentifier(schemaName)) {
      throw new BadRequestError('Generated schema name is invalid. Try a different project ref.');
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
    const anonKey = await generateApiKey('anon', ref, jwtSecret);
    const serviceRoleKey = await generateApiKey('service_role', ref, jwtSecret);

    const client = await fastify.db.connect();
    try {
      await client.query('BEGIN');

      const insertResult = await client.query(
        `INSERT INTO toph_internal.projects (ref, name, schema_name, jwt_secret, anon_key, service_role_key, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, ref, name, schema_name, status, created_at`,
        [ref, body.name, schemaName, jwtSecret, anonKey, serviceRoleKey, userId],
      );

      const project = insertResult.rows[0];

      await client.query(
        `INSERT INTO toph_internal.project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [project.id, userId],
      );

      // Provision the project schema
      await client.query('SELECT toph_internal.provision_project_schema($1)', [schemaName]);

      await client.query('COMMIT');

      reply.status(201).send({
        id: project.id,
        ref: project.ref,
        name: project.name,
        schemaName: project.schema_name,
        status: project.status,
        anonKey,
        serviceRoleKey,
        createdAt: project.created_at,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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

    if (updates.length === 0) {
      throw new BadRequestError('No fields to update');
    }

    updates.push(`updated_at = now()`);
    values.push(ref);

    const result = await fastify.db.query(
      `UPDATE toph_internal.projects SET ${updates.join(', ')} WHERE ref = $${paramIndex} RETURNING id, ref, name, status, updated_at`,
      values,
    );

    invalidateProjectCache(ref);
    return result.rows[0];
  });

  // Delete project (soft delete)
  fastify.delete('/platform/projects/:ref', { preHandler: [requirePlatformAdmin] }, async (request: FastifyRequest) => {
    const { ref } = request.params as { ref: string };
    const userId = request.platformUserId!;

    const check = await fastify.db.query(
      `SELECT p.id FROM toph_internal.projects p
       JOIN toph_internal.project_members pm ON p.id = pm.project_id
       WHERE p.ref = $1 AND pm.user_id = $2 AND pm.role = 'owner' AND p.status != 'deleted'`,
      [ref, userId],
    );
    if (check.rows.length === 0) {
      throw new NotFoundError('Project not found or insufficient permissions');
    }

    await fastify.db.query(
      `UPDATE toph_internal.projects SET status = 'deleted', updated_at = now() WHERE ref = $1`,
      [ref],
    );

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

    const jwtSecret = generateProjectJwtSecret();
    const anonKey = await generateApiKey('anon', ref, jwtSecret);
    const serviceRoleKey = await generateApiKey('service_role', ref, jwtSecret);

    await fastify.db.query(
      `UPDATE toph_internal.projects SET jwt_secret = $1, anon_key = $2, service_role_key = $3, updated_at = now() WHERE ref = $4`,
      [jwtSecret, anonKey, serviceRoleKey, ref],
    );

    invalidateProjectCache(ref);

    return {
      anonKey,
      serviceRoleKey,
      message: 'API keys regenerated. Previous keys are now invalid.',
    };
  });
};

export default projectsPlugin;
