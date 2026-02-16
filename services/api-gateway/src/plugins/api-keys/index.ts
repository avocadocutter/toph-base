import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requirePlatformAdmin } from '../../hooks/authenticate.js';
import { generatePublishableKey, generateSecretKey } from '../auth/jwt.js';
import { NotFoundError, BadRequestError } from '../../lib/errors.js';
import { z } from 'zod';

const createApiKeySchema = z.object({
  keyType: z.enum(['publishable', 'secret']),
  role: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
});

interface ApiKeyRow {
  id: string;
  key_value: string;
  key_prefix: string;
  role: string;
  name: string | null;
  revoked_at: Date | null;
  created_at: Date;
  last_used_at: Date | null;
}

const apiKeysPlugin: FastifyPluginAsync = async (fastify) => {
  // List API keys for a project
  fastify.get(
    '/platform/projects/:ref/api-keys',
    { preHandler: [requirePlatformAdmin] },
    async (request: FastifyRequest) => {
      const { ref } = request.params as { ref: string };
      const userId = request.platformUserId!;

      // Verify user has access to this project
      const accessCheck = await fastify.db.query(
        `SELECT p.id FROM toph_internal.projects p
         JOIN toph_internal.project_members pm ON p.id = pm.project_id
         WHERE p.ref = $1 AND pm.user_id = $2 AND p.status != 'deleted'`,
        [ref, userId],
      );

      if (accessCheck.rows.length === 0) {
        throw new NotFoundError('Project not found');
      }

      const projectId = accessCheck.rows[0].id;

      // Get all API keys for this project
      const result = await fastify.db.query<ApiKeyRow>(
        `SELECT id, key_value, key_prefix, role, name, revoked_at, created_at, last_used_at
         FROM toph_internal.api_keys
         WHERE project_id = $1
         ORDER BY created_at DESC`,
        [projectId],
      );

      return result.rows.map((row) => ({
        id: row.id,
        keyPrefix: row.key_prefix,
        role: row.role,
        name: row.name,
        // Only show last 8 characters of the key for security
        keyHint: row.key_value.slice(-8),
        revoked: !!row.revoked_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      }));
    },
  );

  // Create a new API key
  fastify.post(
    '/platform/projects/:ref/api-keys',
    { preHandler: [requirePlatformAdmin] },
    async (request: FastifyRequest) => {
      const { ref } = request.params as { ref: string };
      const body = createApiKeySchema.parse(request.body);
      const userId = request.platformUserId!;

      // Verify user is owner of this project
      const projectCheck = await fastify.db.query(
        `SELECT p.id FROM toph_internal.projects p
         JOIN toph_internal.project_members pm ON p.id = pm.project_id
         WHERE p.ref = $1 AND pm.user_id = $2 AND pm.role = 'owner' AND p.status != 'deleted'`,
        [ref, userId],
      );

      if (projectCheck.rows.length === 0) {
        throw new NotFoundError('Project not found or insufficient permissions');
      }

      const projectId = projectCheck.rows[0].id;

      // Generate the key based on type
      const keyValue = body.keyType === 'publishable' ? generatePublishableKey() : generateSecretKey();

      // Determine role
      const role =
        body.role ??
        (body.keyType === 'publishable' ? 'anon' : 'service_role');

      // Insert the key
      const result = await fastify.db.query<ApiKeyRow>(
        `INSERT INTO toph_internal.api_keys (project_id, key_value, key_prefix, role, name, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, key_value, key_prefix, role, name, created_at`,
        [projectId, keyValue, body.keyType, role, body.name ?? null, userId],
      );

      const newKey = result.rows[0];

      // Return the full key value ONLY on creation (user won't see it again)
      return {
        id: newKey.id,
        keyValue: newKey.key_value,
        keyPrefix: newKey.key_prefix,
        role: newKey.role,
        name: newKey.name,
        createdAt: newKey.created_at,
        message: 'Save this key securely. You will not be able to view it again.',
      };
    },
  );

  // Revoke an API key
  fastify.delete(
    '/platform/projects/:ref/api-keys/:keyId',
    { preHandler: [requirePlatformAdmin] },
    async (request: FastifyRequest) => {
      const { ref, keyId } = request.params as { ref: string; keyId: string };
      const userId = request.platformUserId!;

      // Verify ownership and that the key belongs to this project
      const result = await fastify.db.query(
        `SELECT ak.id FROM toph_internal.api_keys ak
         JOIN toph_internal.projects p ON ak.project_id = p.id
         JOIN toph_internal.project_members pm ON p.id = pm.project_id
         WHERE ak.id = $1 AND p.ref = $2 AND pm.user_id = $3 AND pm.role = 'owner'
               AND ak.revoked_at IS NULL`,
        [keyId, ref, userId],
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('API key not found or already revoked');
      }

      // Revoke the key
      await fastify.db.query('SELECT toph_internal.revoke_api_key($1)', [keyId]);

      return {
        message: 'API key revoked successfully',
        revokedAt: new Date().toISOString(),
      };
    },
  );
};

export default apiKeysPlugin;
