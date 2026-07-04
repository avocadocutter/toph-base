import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGliteStore } from '../../db/pglite-store.js';
import jobQueuePlugin from './index.js';

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('waitFor: timed out');
}

async function insertJob(
  store: PGliteStore,
  functionName: string,
  runtime: 'edge' | 'node',
  payload: unknown = {},
): Promise<void> {
  await store.query(
    `INSERT INTO public.jobs (function_name, runtime, payload) VALUES ($1, $2, $3)`,
    [functionName, runtime, JSON.stringify(payload)],
  );
}

async function jobStatus(store: PGliteStore, functionName: string): Promise<{ status: string; attempts: number; error: string | null } | undefined> {
  const result = await store.query<{ status: string; attempts: number; error: string | null }>(
    `SELECT status, attempts, error FROM public.jobs WHERE function_name = $1`,
    [functionName],
  );
  return result.rows[0];
}

describe('job-queue plugin', () => {
  let dataDir: string;
  let store: PGliteStore;
  let fastify: FastifyInstance;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-queue-test-'));
    store = new PGliteStore(dataDir);
    await store.init();
    await store.exec(`
      CREATE TABLE public.jobs (
        id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        function_name text        NOT NULL,
        runtime       text        NOT NULL DEFAULT 'edge' CHECK (runtime IN ('edge', 'node')),
        payload       jsonb       NOT NULL DEFAULT '{}',
        status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
        attempts      int         NOT NULL DEFAULT 0,
        error         text,
        result        jsonb,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION public.notify_jobs_queue() RETURNS trigger
        LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_notify('jobs_queue', NEW.id::text);
        RETURN NEW;
      END $$;

      CREATE TRIGGER jobs_notify
        AFTER INSERT ON public.jobs
        FOR EACH ROW EXECUTE FUNCTION public.notify_jobs_queue();
    `);

    fastify = Fastify();
  });

  afterEach(async () => {
    await fastify.close();
    await store.end();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('dequeues a pending job and invokes the matching Edge Function route', async () => {
    const handler = vi.fn(async (_request, reply) => reply.send({ ok: true }));
    fastify.post('/functions/v1/process-document', handler);
    await fastify.register(jobQueuePlugin, { store });
    await fastify.ready();

    await insertJob(store, 'process-document', 'edge', { foo: 'bar' });

    await waitFor(async () => (await jobStatus(store, 'process-document'))?.status === 'done');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('routes runtime "node" jobs to /node-functions/v1/*', async () => {
    const edgeHandler = vi.fn(async (_request, reply) => reply.send({ ok: true }));
    const nodeHandler = vi.fn(async (_request, reply) => reply.send({ ok: true }));
    fastify.post('/functions/v1/resize-image', edgeHandler);
    fastify.post('/node-functions/v1/resize-image', nodeHandler);
    await fastify.register(jobQueuePlugin, { store });
    await fastify.ready();

    await insertJob(store, 'resize-image', 'node');

    await waitFor(async () => (await jobStatus(store, 'resize-image'))?.status === 'done');
    expect(nodeHandler).toHaveBeenCalledTimes(1);
    expect(edgeHandler).not.toHaveBeenCalled();
  });

  it('retries a failing job until max attempts, then marks it failed', async () => {
    const handler = vi.fn(async (_request, reply) => reply.status(500).send({ error: 'boom' }));
    fastify.post('/functions/v1/flaky', handler);
    await fastify.register(jobQueuePlugin, { store, maxAttempts: 2 });
    await fastify.ready();

    await insertJob(store, 'flaky', 'edge');

    await waitFor(async () => (await jobStatus(store, 'flaky'))?.status === 'failed');

    const job = await jobStatus(store, 'flaky');
    expect(job?.attempts).toBe(2);
    expect(job?.error).toContain('500');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('processes jobs queued while offline as soon as the plugin registers', async () => {
    await insertJob(store, 'catch-up', 'edge');

    fastify.post('/functions/v1/catch-up', async (_request, reply) => reply.send({ ok: true }));
    await fastify.register(jobQueuePlugin, { store });
    await fastify.ready();

    await waitFor(async () => (await jobStatus(store, 'catch-up'))?.status === 'done');
  });
});
