import fastifyStatic from '@fastify/static';
import { createServer } from '@tophbase/api';
import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function start(): Promise<void> {
  const { fastify, config, store } = await createServer();

  // Two layouts:
  //   repo dev:  orchestrator/src/__dirname → ../../dashboard/dist = apps/dashboard/dist
  //   npm pkg:   orchestrator/dist/__dirname → ../dashboard = bundled dashboard/
  const dashboardCandidates = [
    path.resolve(__dirname, '../dashboard'),          // npm package layout
    path.resolve(__dirname, '../../dashboard/dist'),  // repo dev layout
  ];
  const dashboardPath = (await Promise.all(
    dashboardCandidates.map(p => fs.access(p).then(() => p).catch(() => null))
  )).find(Boolean) ?? dashboardCandidates[1];

  try {
    await fs.access(dashboardPath);
    await fastify.register(fastifyStatic, {
      root: dashboardPath,
      prefix: '/',
      wildcard: false,
      decorateReply: true,
    });
    fastify.setNotFoundHandler((request, reply) => {
      const apiPrefixes = ['/rest/', '/auth/', '/realtime/', '/health', '/tophbase/', '/admin/'];
      if (apiPrefixes.some(p => request.url.startsWith(p))) {
        reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
      } else {
        reply.sendFile('index.html');
      }
    });
  } catch {
    fastify.log.debug('Dashboard not built — serving API only');
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    fastify.log.info('Shutting down...');
    setTimeout(() => process.exit(1), 5000).unref();
    await fastify.close();
    await store.end();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await fastify.listen({ port: config.server.port, host: config.server.host });

  const url = `http://localhost:${config.server.port}`;
  console.log('');
  console.log(`  Tophbase running at ${url}`);
  console.log(`  Publishable key: ${config.project.publishableKey}`);
  console.log(`  Secret key:      ${config.project.secretKey}`);
  console.log('');

  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} ${url}`);
}
