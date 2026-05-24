import fastifyStatic from '@fastify/static';
import { createServer } from '@tophbase/api';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SSL_REQUEST_CODE = 80877103; // 0x04D2162F — PostgreSQL SSLRequest message

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
      const apiPrefixes = ['/rest/', '/auth/', '/realtime/', '/health', '/tophbase/', '/admin/', '/functions/'];
      if (apiPrefixes.some(p => request.url.startsWith(p))) {
        reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
      } else {
        reply.sendFile('index.html');
      }
    });
  } catch {
    fastify.log.debug('Dashboard not built — serving API only');
  }

  const pgPortRaw = process.env.TOPHBASE_PG_PORT;
  const pgPort = pgPortRaw ? parseInt(pgPortRaw, 10) : undefined;

  let pgServer: PGLiteSocketServer | undefined;
  let tcpServer: net.Server | undefined;

  if (pgPort !== undefined) {
    // pglite-socket listens on a Unix socket internally so we can proxy in front of it
    const unixPath = path.join(os.tmpdir(), `tophbase-${pgPort}.sock`);
    try { await fs.unlink(unixPath); } catch { /* ignore if missing */ }

    pgServer = new PGLiteSocketServer({ db: store.getPglite(), path: unixPath });
    await pgServer.start();

    // TCP server that handles the PostgreSQL SSLRequest before forwarding to pglite-socket
    tcpServer = net.createServer((clientSocket) => {
      clientSocket.once('data', (firstChunk) => {
        clientSocket.pause();

        const forward = (prelude: Buffer) => {
          const internal = net.createConnection(unixPath);
          internal.once('connect', () => {
            if (prelude.length > 0) internal.write(prelude);
            clientSocket.pipe(internal);
            internal.pipe(clientSocket);
            clientSocket.resume();
          });
          internal.on('error', () => clientSocket.destroy());
          clientSocket.on('error', () => internal.destroy());
        };

        if (firstChunk.length >= 8 && firstChunk.readInt32BE(4) === SSL_REQUEST_CODE) {
          clientSocket.write(Buffer.from('N')); // decline SSL, client will retry in plaintext
          forward(firstChunk.slice(8));
        } else {
          forward(firstChunk);
        }
      });

      clientSocket.on('error', () => {});
    });

    await new Promise<void>((resolve, reject) => {
      tcpServer!.listen(pgPort, '127.0.0.1', resolve);
      tcpServer!.once('error', reject);
    });
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    fastify.log.info('Shutting down...');
    setTimeout(() => process.exit(1), 5000).unref();
    tcpServer?.close();
    await pgServer?.stop();
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
  console.log(`  Data dir:        ${config.project.dataDir}`);
  console.log(`  Publishable key: ${config.project.publishableKey}`);
  console.log(`  Secret key:      ${config.project.secretKey}`);
  if (pgPort !== undefined) {
    console.log('');
    console.log(`  Postgres (Postico/psql)`);
    console.log(`    Host:     127.0.0.1`);
    console.log(`    Port:     ${pgPort}`);
    console.log(`    Database: postgres`);
    console.log(`    User:     postgres`);
    console.log(`    Password: (leave blank)`);
  }
  console.log('');
}
