import type { FastifyPluginAsync } from 'fastify';
import { spawn, spawnSync } from 'node:child_process';
import { writeFile, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

export interface EdgeFunctionsOptions {
  functionsDir: string;
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
}

interface FunctionProcess {
  port: number;
  proc: ReturnType<typeof spawn>;
  ready: Promise<void>;
}

// Shim that replaces the Deno std http/server.ts `serve` export.
// Injected via Deno import map so the real Deno.serve is called directly —
// no runtime monkey-patching needed.
const DENO_SERVE_SHIM = `
const _port = parseInt(Deno.env.get('TOPHBASE_PORT') ?? '0', 10);

export async function serve(handler, _options) {
  const server = Deno.serve(
    { port: _port, hostname: '127.0.0.1', onListen: () => console.log('TOPHBASE_READY') },
    handler,
  );
  await server.finished;
}

// Also export serveListener / Handler types so imports don't break
export type Handler = (req: Request) => Response | Promise<Response>;
`;

// Fallback runner for functions that call Deno.serve() directly (not via std serve).
const DENO_RUNNER_FALLBACK = `
const [funcPath, portStr] = Deno.args;
const port = parseInt(portStr, 10);
const _orig = Deno.serve.bind(Deno);
function _wrap(handlerOrOptions, maybeHandler) {
  let h;
  if (typeof handlerOrOptions === 'function') h = handlerOrOptions;
  else if (handlerOrOptions?.fetch) h = handlerOrOptions.fetch.bind(handlerOrOptions);
  else if (handlerOrOptions?.handler) h = handlerOrOptions.handler;
  else h = maybeHandler;
  return _orig({ port, hostname: '127.0.0.1', onListen: () => console.log('TOPHBASE_READY') }, h);
}
Object.defineProperty(Deno, 'serve', { value: _wrap, writable: true, configurable: true });
await import(\`file://\${funcPath}\`);
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

function isDenoAvailable(): boolean {
  try {
    const r = spawnSync('deno', ['--version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}

async function findFunctionFile(functionsDir: string, name: string): Promise<string | null> {
  const candidates = [
    join(functionsDir, name, 'index.ts'),
    join(functionsDir, name, 'index.tsx'),
    join(functionsDir, name, 'index.js'),
    join(functionsDir, name + '.ts'),
    join(functionsDir, name + '.js'),
  ];
  for (const p of candidates) {
    try {
      await access(p);
      return resolve(p);
    } catch { /* try next */ }
  }
  return null;
}

// Extract every `https://deno.land/std@.../http/server.ts` URL from the function source.
function extractStdServeUrls(source: string): string[] {
  const found = new Set<string>();
  const re = /from\s+['"]([^'"]*\/http\/server\.ts)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) found.add(m[1]);
  return [...found];
}

const edgeFunctionsPlugin: FastifyPluginAsync<EdgeFunctionsOptions> = async (fastify, opts) => {
  const { functionsDir, supabaseUrl, publishableKey, secretKey } = opts;

  const denoAvailable = isDenoAvailable();

  const shimPath = join(tmpdir(), 'tophbase-serve-shim.ts');
  const runnerPath = join(tmpdir(), 'tophbase-edge-runner.ts');
  if (denoAvailable) {
    await writeFile(shimPath, DENO_SERVE_SHIM, 'utf8');
    await writeFile(runnerPath, DENO_RUNNER_FALLBACK, 'utf8');
  }

  const processes = new Map<string, FunctionProcess>();

  async function getOrSpawn(name: string, funcPath: string): Promise<number> {
    const existing = processes.get(name);
    if (existing) {
      await existing.ready;
      return existing.port;
    }

    const port = await getFreePort();

    // Scan the function file for std http/server.ts imports and build an import map
    // that redirects them to our shim. The shim exports `serve` and calls the real
    // Deno.serve on the port we chose.
    const source = await readFile(funcPath, 'utf8');
    const stdUrls = extractStdServeUrls(source);
    const importMap: { imports: Record<string, string> } = { imports: {} };
    for (const url of stdUrls) {
      importMap.imports[url] = `file://${shimPath}`;
    }
    const importMapPath = join(tmpdir(), `tophbase-map-${encodeURIComponent(name)}.json`);
    await writeFile(importMapPath, JSON.stringify(importMap), 'utf8');

    // If std serve URLs were found, run the function directly with the import map.
    // Otherwise fall back to the runner script which overrides Deno.serve.
    const useImportMap = stdUrls.length > 0;
    const denoArgs = useImportMap
      ? ['run', '--allow-all', `--import-map=${importMapPath}`, funcPath]
      : ['run', '--allow-all', runnerPath, funcPath, String(port)];

    const proc = spawn('deno', denoArgs, {
      env: {
        ...process.env,
        TOPHBASE_PORT: String(port),
        SUPABASE_URL: supabaseUrl,
        SUPABASE_ANON_KEY: publishableKey,
        SUPABASE_SERVICE_ROLE_KEY: secretKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolveReady!: () => void;
    let rejectReady!: (err: Error) => void;
    const ready = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });

    const entry: FunctionProcess = { port, proc, ready };
    processes.set(name, entry);

    const timeout = setTimeout(() => {
      rejectReady(new Error(`edge function '${name}' did not start within 30s`));
    }, 30_000);

    proc.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('TOPHBASE_READY')) {
        clearTimeout(timeout);
        resolveReady();
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trimEnd();
      fastify.log.warn(`[edge:${name}] ${msg.length > 100 ? msg.slice(0, 100) + '…' : msg}`);
    });

    proc.on('exit', (code) => {
      processes.delete(name);
      clearTimeout(timeout);
      rejectReady(new Error(`edge function '${name}' exited (code ${code ?? 0}) before becoming ready`));
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
    if (!denoAvailable) {
      return reply.status(501).send({ error: { code: 'DENO_REQUIRED', message: 'Edge functions require Deno. Install it from https://deno.com and restart tophbase.' } });
    }

    const star = request.params['*'] ?? '';
    const name = star.split('/')[0];
    if (!name) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Function name required' } });

    const funcPath = await findFunctionFile(functionsDir, name);
    if (!funcPath) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Edge function '${name}' not found` } });

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
        // @ts-ignore — Node 18+ fetch requires duplex for request bodies
        duplex: hasBody ? 'half' : undefined,
        signal: abort.signal,
      });
    } catch (err) {
      processes.delete(name);
      fastify.log.error(err);
      if ((err as Error).name === 'AbortError') {
        return reply.status(504).send({ error: { code: 'FUNCTION_TIMEOUT', message: `Edge function '${name}' timed out` } });
      }
      return reply.status(502).send({ error: { code: 'FUNCTION_UNAVAILABLE', message: 'Edge function unavailable' } });
    } finally {
      clearTimeout(fetchTimeout);
    }

    reply.status(res.status);
    res.headers.forEach((v, k) => {
      // Node fetch decodes content-encoding automatically; forwarding the header
      // would cause the browser to attempt a second decode on plain bytes.
      if (k === 'transfer-encoding' || k === 'content-encoding') return;
      reply.header(k, v);
    });

    const responseBody = Buffer.from(await res.arrayBuffer());
    fastify.log.debug(`[edge:${name}] response ${res.status} body: ${responseBody.length > 100 ? responseBody.subarray(0, 100).toString() + '…' : responseBody.toString()}`);
    return reply.send(responseBody);
  };

  fastify.all('/functions/v1/*', handler);
};

export default edgeFunctionsPlugin;
