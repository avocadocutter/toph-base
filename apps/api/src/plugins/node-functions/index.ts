import type { FastifyPluginAsync } from 'fastify';
import { spawn, spawnSync } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

export interface NodeFunctionsOptions {
  functionsDir: string | null;
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  secretsPath: string;
}

interface FunctionProcess {
  port: number;
  proc: ReturnType<typeof spawn>;
  ready: Promise<void>;
}

// Runner script spawned per Node.js function.
// Bridges Node.js http.IncomingMessage <-> Web Request/Response API.
// Functions must export: `export default { fetch(req: Request): Promise<Response> }`
// or `export default async function(req: Request): Promise<Response>`.
const NODE_RUNNER = `
import { createServer } from 'node:http';

process.on('uncaughtException', (err) => {
  console.error('[tophbase-node] Uncaught exception:', err.stack ?? err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[tophbase-node] Unhandled rejection:', reason instanceof Error ? reason.stack ?? reason.message : reason);
});

const [funcPath, portStr] = process.argv.slice(2);
const port = parseInt(portStr, 10);

let mod;
try {
  mod = await import(\`file://\${funcPath}\`);
} catch (err) {
  console.error('[tophbase-node] Failed to import function:', err.stack ?? err.message);
  process.exit(1);
}

const handler = mod.default?.fetch ?? mod.default;
if (typeof handler !== 'function') {
  console.error('[tophbase-node] Node function must export default { fetch } or a default function');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : null;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v != null && k !== 'host') headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }

    const proto = req.headers['x-forwarded-proto'] ?? 'http';
    const host = req.headers['x-forwarded-host'] ?? req.headers['host'] ?? 'localhost';
    const url = \`\${proto}://\${host}\${req.url}\`;

    const webReq = new Request(url, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' && body?.length ? body : null,
    });

    const webRes = await handler(webReq);

    res.statusCode = webRes.status;
    webRes.headers.forEach((v, k) => {
      if (k !== 'transfer-encoding' && k !== 'content-encoding') res.setHeader(k, v);
    });
    const resBody = Buffer.from(await webRes.arrayBuffer());
    if (webRes.status >= 400) {
      console.error(\`[tophbase-node] \${req.method} \${req.url} -> \${webRes.status}: \${resBody.toString().slice(0, 500)}\`);
    }
    res.end(resBody);
  } catch (err) {
    console.error('[tophbase-node] Handler error:', err.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('TOPHBASE_READY');
});
`;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

function isNodeAvailable(): boolean {
  try {
    const r = spawnSync(process.execPath, ['--version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}

async function findFunctionFile(functionsDir: string, name: string): Promise<string | null> {
  const { access } = await import('node:fs/promises');
  const candidates = [
    join(functionsDir, name, 'index.js'),
    join(functionsDir, name, 'index.mjs'),
    join(functionsDir, name, 'index.ts'),
    join(functionsDir, name + '.js'),
    join(functionsDir, name + '.mjs'),
    join(functionsDir, name + '.ts'),
  ];
  for (const p of candidates) {
    try {
      await access(p);
      return resolve(p);
    } catch { /* try next */ }
  }
  return null;
}

async function readSecrets(secretsPath: string): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await readFile(secretsPath, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, string>;
  } catch { /* no secrets file */ }
  return {};
}

const nodeFunctionsPlugin: FastifyPluginAsync<NodeFunctionsOptions> = async (fastify, opts) => {
  const { functionsDir, supabaseUrl, publishableKey, secretKey, secretsPath } = opts;

  const runnerPath = join(tmpdir(), 'tophbase-node-runner.mjs');
  await writeFile(runnerPath, NODE_RUNNER, 'utf8');

  const processes = new Map<string, FunctionProcess>();

  fastify.decorate('killNodeFunctions', () => {
    for (const { proc } of processes.values()) proc.kill();
    processes.clear();
  });

  async function getOrSpawn(name: string, funcPath: string): Promise<number> {
    const existing = processes.get(name);
    if (existing) {
      await existing.ready;
      return existing.port;
    }

    const port = await getFreePort();
    const secrets = await readSecrets(secretsPath);

    const proc = spawn(process.execPath, [runnerPath, funcPath, String(port)], {
      cwd: dirname(funcPath),
      env: {
        ...process.env,
        ...secrets,
        SUPABASE_URL: supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: publishableKey,
        SUPABASE_SECRET_KEY: secretKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolveReady!: () => void;
    let rejectReady!: (err: Error) => void;
    const ready = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });

    const entry: FunctionProcess = { port, proc, ready };
    processes.set(name, entry);

    const timeout = setTimeout(() => {
      rejectReady(new Error(`node function '${name}' did not start within 30s`));
    }, 30_000);

    const preReadyBuffer: string[] = [];
    let isReady = false;
    proc.stdout!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (!isReady) {
        const lines = text.split('\n');
        const readyIdx = lines.findIndex(l => l.includes('TOPHBASE_READY'));
        if (readyIdx !== -1) {
          clearTimeout(timeout);
          isReady = true;
          for (const line of [...preReadyBuffer, ...lines.slice(0, readyIdx)]) {
            if (line.trim()) fastify.log.info(`[node:${name}] ${line}`);
          }
          preReadyBuffer.length = 0;
          resolveReady();
          for (const line of lines.slice(readyIdx + 1)) {
            if (line.trim()) fastify.log.info(`[node:${name}] ${line}`);
          }
        } else {
          for (const line of lines) {
            if (line.trim()) preReadyBuffer.push(line);
          }
        }
        return;
      }
      for (const line of text.trimEnd().split('\n')) {
        if (line) fastify.log.info(`[node:${name}] ${line}`);
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().trimEnd().split('\n')) {
        if (line) fastify.log.error(`[node:${name}] ${line}`);
      }
    });

    proc.on('exit', (code) => {
      processes.delete(name);
      clearTimeout(timeout);
      rejectReady(new Error(`node function '${name}' exited (code ${code ?? 0}) before becoming ready`));
    });

    await ready;
    return port;
  }

  fastify.addHook('onClose', async () => {
    for (const { proc } of processes.values()) proc.kill();
    processes.clear();
  });

  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  const handler = async (request: import('fastify').FastifyRequest<{ Params: { '*': string } }>, reply: import('fastify').FastifyReply) => {
    if (!functionsDir) {
      return reply.status(501).send({ error: { code: 'NODE_FUNCTIONS_NOT_CONFIGURED', message: 'Node functions directory is not configured. Run tophbase freshman --node-functions-dir <path> to enable.' } });
    }

    if (!isNodeAvailable()) {
      return reply.status(501).send({ error: { code: 'NODE_REQUIRED', message: 'Node functions require a working Node.js installation.' } });
    }

    const star = request.params['*'] ?? '';
    const name = star.split('/')[0];
    if (!name) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Function name required' } });

    const funcPath = await findFunctionFile(functionsDir, name);
    if (!funcPath) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Node function '${name}' not found` } });

    let port: number;
    try {
      port = await getOrSpawn(name, funcPath);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(502).send({ error: { code: 'FUNCTION_ERROR', message: (err as Error).message } });
    }

    const headers = new Headers();
    for (const [k, v] of Object.entries(request.headers)) {
      if (v == null || k === 'host') continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    headers.set('x-forwarded-host', request.headers.host ?? 'localhost');

    const rawBody = request.body as Buffer | null;
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && rawBody && rawBody.length > 0;

    let res: Response;
    const abort = new AbortController();
    const fetchTimeout = setTimeout(() => abort.abort(), 30_000);
    try {
      res = await fetch(`http://127.0.0.1:${port}${request.url}`, {
        method: request.method,
        headers,
        body: hasBody ? rawBody : undefined,
        duplex: hasBody ? 'half' : undefined,
        signal: abort.signal,
      } as RequestInit);
    } catch (err) {
      processes.delete(name);
      fastify.log.error(err);
      if ((err as Error).name === 'AbortError') {
        return reply.status(504).send({ error: { code: 'FUNCTION_TIMEOUT', message: `Node function '${name}' timed out` } });
      }
      return reply.status(502).send({ error: { code: 'FUNCTION_UNAVAILABLE', message: 'Node function unavailable' } });
    } finally {
      clearTimeout(fetchTimeout);
    }

    reply.status(res.status);
    res.headers.forEach((v, k) => {
      if (k === 'transfer-encoding' || k === 'content-encoding') return;
      reply.header(k, v);
    });

    const responseBody = Buffer.from(await res.arrayBuffer());
    if (res.status >= 500) {
      fastify.log.error(`[node:${name}] responded ${res.status}: ${responseBody.toString().slice(0, 500)}`);
    }
    return reply.send(responseBody);
  };

  fastify.all('/node-functions/v1/*', handler);
};

export default nodeFunctionsPlugin;
