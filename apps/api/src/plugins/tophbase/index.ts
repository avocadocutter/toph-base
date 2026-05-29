import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dialect } from '../../lib/project-config.js';
import { saveProjectConfig, loadOrCreateProjectConfig, loadSecrets, saveSecrets } from '../../lib/project-config.js';

const setupSchema = z.object({
  dialect: z.enum(['supabase', 'pocketbase', 'appwrite']),
});

export interface TophbaseStatus {
  configured: boolean;
  dialect: Dialect | null;
  version: string;
  url: string;
  publishableKey: string;
  secretKey: string;
  functionsDir: string | null;
}

export interface EdgeFunction {
  name: string;
  url: string;
}

async function listFunctions(functionsDir: string, baseUrl: string): Promise<EdgeFunction[]> {
  const results: EdgeFunction[] = [];
  try {
    const entries = await fs.readdir(functionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Check for index file
        const candidates = ['index.ts', 'index.tsx', 'index.js'];
        for (const c of candidates) {
          try {
            await fs.access(path.join(functionsDir, entry.name, c));
            results.push({ name: entry.name, url: `${baseUrl}/functions/v1/${entry.name}` });
            break;
          } catch { /* try next */ }
        }
      } else if (/\.(ts|tsx|js)$/.test(entry.name) && !entry.name.startsWith('_')) {
        const name = entry.name.replace(/\.(ts|tsx|js)$/, '');
        results.push({ name, url: `${baseUrl}/functions/v1/${name}` });
      }
    }
  } catch { /* dir doesn't exist yet */ }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function resolvePublicUrl(port: number): string {
  if (process.env.TOPHBASE_PUBLIC_URL) return process.env.TOPHBASE_PUBLIC_URL;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${port}`;
}

const tophbasePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: TophbaseStatus }>('/tophbase/status', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { project, server, functions } = fastify.config;
    reply.send({
      configured: (fastify as unknown as { _tophbaseDialect: Dialect | null })._tophbaseDialect != null,
      dialect: (fastify as unknown as { _tophbaseDialect: Dialect | null })._tophbaseDialect ?? null,
      version: '0.1.0',
      url: resolvePublicUrl(server.port),
      publishableKey: project.publishableKey,
      secretKey: project.secretKey,
      functionsDir: functions.dir,
    });
  });

  fastify.get('/tophbase/functions', async (_req, reply) => {
    const { functions, server } = fastify.config;
    const baseUrl = resolvePublicUrl(server.port);
    const fns = functions.dir ? await listFunctions(functions.dir, baseUrl) : [];
    reply.send({ functionsDir: functions.dir, functions: fns });
  });

  fastify.get<{ Params: { name: string } }>('/tophbase/functions/:name', async (request, reply) => {
    const { functions } = fastify.config;
    if (!functions.dir) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Functions not configured' } });
    }
    const { name } = request.params;
    const candidates = [
      path.join(functions.dir, name, 'index.ts'),
      path.join(functions.dir, name, 'index.tsx'),
      path.join(functions.dir, name, 'index.js'),
      path.join(functions.dir, name + '.ts'),
      path.join(functions.dir, name + '.js'),
    ];
    for (const filePath of candidates) {
      try {
        const source = await fs.readFile(filePath, 'utf8');
        return reply.send({ name, source, path: filePath });
      } catch { /* try next */ }
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Function '${name}' not found` } });
  });

  fastify.get('/tophbase/secrets', async (_req, reply) => {
    const secrets = await loadSecrets(fastify.config.project.dataDir);
    reply.send({ secrets });
  });

  fastify.post('/tophbase/secrets', async (request, reply) => {
    const { key, value } = z.object({ key: z.string().min(1), value: z.string() }).parse(request.body);
    const secrets = await loadSecrets(fastify.config.project.dataDir);
    secrets[key] = value;
    await saveSecrets(fastify.config.project.dataDir, secrets);
    (fastify as unknown as { killEdgeFunctions?: () => void }).killEdgeFunctions?.();
    reply.send({ ok: true });
  });

  fastify.delete<{ Params: { key: string } }>('/tophbase/secrets/:key', async (request, reply) => {
    const { key } = request.params;
    const secrets = await loadSecrets(fastify.config.project.dataDir);
    delete secrets[key];
    await saveSecrets(fastify.config.project.dataDir, secrets);
    (fastify as unknown as { killEdgeFunctions?: () => void }).killEdgeFunctions?.();
    reply.send({ ok: true });
  });

  fastify.post('/tophbase/setup', async (request, reply) => {
    const body = setupSchema.parse(request.body);
    const { project } = fastify.config;
    const config = await loadOrCreateProjectConfig(project.dataDir);
    config.dialect = body.dialect;
    await saveProjectConfig(project.dataDir, config);
    (fastify as unknown as { _tophbaseDialect: Dialect | null })._tophbaseDialect = body.dialect;
    reply.send({ ok: true, dialect: body.dialect });
  });
};

export default tophbasePlugin;
