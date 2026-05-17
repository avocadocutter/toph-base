import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Dialect } from '../../lib/project-config.js';
import { saveProjectConfig, loadOrCreateProjectConfig } from '../../lib/project-config.js';

const setupSchema = z.object({
  dialect: z.enum(['supabase', 'pocketbase', 'appwrite']),
});

export interface VibebaseStatus {
  configured: boolean;
  dialect: Dialect | null;
  version: string;
  url: string;
  publishableKey: string;
  secretKey: string;
}

const vibebasePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: VibebaseStatus }>('/vibebase/status', async (_req, reply) => {
    const { project, server } = fastify.config;
    reply.send({
      configured: (fastify as unknown as { _vibebaseDialect: Dialect | null })._vibebaseDialect != null,
      dialect: (fastify as unknown as { _vibebaseDialect: Dialect | null })._vibebaseDialect ?? null,
      version: '0.1.0',
      url: `http://localhost:${server.port}`,
      publishableKey: project.publishableKey,
      secretKey: project.secretKey,
    });
  });

  fastify.post('/vibebase/setup', async (request, reply) => {
    const body = setupSchema.parse(request.body);
    const { project } = fastify.config;
    const config = await loadOrCreateProjectConfig(project.dataDir);
    config.dialect = body.dialect;
    await saveProjectConfig(project.dataDir, config);
    (fastify as unknown as { _vibebaseDialect: Dialect | null })._vibebaseDialect = body.dialect;
    reply.send({ ok: true, dialect: body.dialect });
  });
};

export default vibebasePlugin;
