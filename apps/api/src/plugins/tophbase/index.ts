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
  functionsDir: string | null;
  nodeFunctionsDir: string | null;
}

export interface EdgeFunction {
  name: string;
  url: string;
}

async function listNodeFunctions(functionsDir: string, baseUrl: string): Promise<EdgeFunction[]> {
  const results: EdgeFunction[] = [];
  try {
    const entries = await fs.readdir(functionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidates = ['index.js', 'index.mjs', 'index.ts'];
        for (const c of candidates) {
          try {
            await fs.access(path.join(functionsDir, entry.name, c));
            results.push({ name: entry.name, url: `${baseUrl}/node-functions/v1/${entry.name}` });
            break;
          } catch { /* try next */ }
        }
      } else if (/\.(js|mjs|ts)$/.test(entry.name) && !entry.name.startsWith('_')) {
        const name = entry.name.replace(/\.(js|mjs|ts)$/, '');
        results.push({ name, url: `${baseUrl}/node-functions/v1/${name}` });
      }
    }
  } catch { /* dir doesn't exist yet */ }
  return results.sort((a, b) => a.name.localeCompare(b.name));
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
    const { project, server, functions, nodeFunctions } = fastify.config;
    reply.send({
      configured: (fastify as unknown as { _tophbaseDialect: Dialect | null })._tophbaseDialect != null,
      dialect: (fastify as unknown as { _tophbaseDialect: Dialect | null })._tophbaseDialect ?? null,
      version: '0.1.0',
      url: resolvePublicUrl(server.port),
      publishableKey: project.publishableKey,
      functionsDir: functions.dir,
      nodeFunctionsDir: nodeFunctions.dir,
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
    const base = path.resolve(functions.dir);
    const candidates = [
      path.join(functions.dir, name, 'index.ts'),
      path.join(functions.dir, name, 'index.tsx'),
      path.join(functions.dir, name, 'index.js'),
      path.join(functions.dir, name + '.ts'),
      path.join(functions.dir, name + '.js'),
    ].filter(p => path.resolve(p).startsWith(base + path.sep) || path.resolve(p) === base);
    for (const filePath of candidates) {
      try {
        const source = await fs.readFile(filePath, 'utf8');
        return reply.send({ name, source, path: filePath });
      } catch { /* try next */ }
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Function '${name}' not found` } });
  });

  fastify.get('/tophbase/node-functions', async (_req, reply) => {
    const { nodeFunctions, server } = fastify.config;
    const baseUrl = resolvePublicUrl(server.port);
    const fns = nodeFunctions.dir ? await listNodeFunctions(nodeFunctions.dir, baseUrl) : [];
    reply.send({ functionsDir: nodeFunctions.dir, functions: fns });
  });

  fastify.get<{ Params: { name: string } }>('/tophbase/node-functions/:name', async (request, reply) => {
    const { nodeFunctions } = fastify.config;
    if (!nodeFunctions.dir) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Node functions not configured' } });
    }
    const { name } = request.params;
    const base = path.resolve(nodeFunctions.dir);
    const candidates = [
      path.join(nodeFunctions.dir, name, 'index.js'),
      path.join(nodeFunctions.dir, name, 'index.mjs'),
      path.join(nodeFunctions.dir, name, 'index.ts'),
      path.join(nodeFunctions.dir, name + '.js'),
      path.join(nodeFunctions.dir, name + '.mjs'),
      path.join(nodeFunctions.dir, name + '.ts'),
    ].filter(p => path.resolve(p).startsWith(base + path.sep) || path.resolve(p) === base);
    for (const filePath of candidates) {
      try {
        const source = await fs.readFile(filePath, 'utf8');
        return reply.send({ name, source, path: filePath });
      } catch { /* try next */ }
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Node function '${name}' not found` } });
  });

  // Only same-origin browser requests (and non-browser callers) can reach this.
  // Cross-origin fetches always carry an Origin header; we reject them so that
  // a malicious page cannot steal the service-role JWT.
  fastify.get('/tophbase/secret-key', async (request, reply) => {
    if (request.headers.origin) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    reply.header('Cache-Control', 'no-store');
    return { secretKey: fastify.config.project.secretKey };
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
    (fastify as unknown as { killEdgeFunctions?: () => void; killNodeFunctions?: () => void }).killEdgeFunctions?.();
    (fastify as unknown as { killNodeFunctions?: () => void }).killNodeFunctions?.();
    reply.send({ ok: true });
  });

  fastify.delete<{ Params: { key: string } }>('/tophbase/secrets/:key', async (request, reply) => {
    const { key } = request.params;
    const secrets = await loadSecrets(fastify.config.project.dataDir);
    delete secrets[key];
    await saveSecrets(fastify.config.project.dataDir, secrets);
    (fastify as unknown as { killEdgeFunctions?: () => void; killNodeFunctions?: () => void }).killEdgeFunctions?.();
    (fastify as unknown as { killNodeFunctions?: () => void }).killNodeFunctions?.();
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
