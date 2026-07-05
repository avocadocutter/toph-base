import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { PGliteStore } from '../../db/pglite-store.js';
import { resolveLocalProject } from '../../hooks/resolve-project.js';
import { authenticateProject } from '../../hooks/authenticate.js';
import { listFunctions, listNodeFunctions } from '../tophbase/index.js';

export interface JobQueueOptions {
  store: PGliteStore;
  maxAttempts: number;
}

const createJobSchema = z.object({
  runtime: z.enum(['edge', 'node']).default('edge'),
  payload: z.record(z.unknown()).default({}),
});

interface QueuedJob {
  id: string;
  function_name: string;
  runtime: 'edge' | 'node';
  payload: unknown;
  attempts: number;
}

const DEQUEUE_SQL = `
  WITH next_job AS (
    SELECT id FROM public.jobs
    WHERE status = 'pending'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.jobs AS j
  SET status = 'processing', updated_at = now()
  FROM next_job
  WHERE j.id = next_job.id
  RETURNING j.id, j.function_name, j.runtime, j.payload, j.attempts;
`;

const RUNTIME_PREFIX: Record<QueuedJob['runtime'], string> = {
  edge: '/functions/v1/',
  node: '/node-functions/v1/',
};

const jobQueuePlugin: FastifyPluginAsync<JobQueueOptions> = async (fastify, opts) => {
  const { store, maxAttempts } = opts;

  let running = false;
  let rerunRequested = false;
  let closed = false;

  async function processJob(job: QueuedJob): Promise<void> {
    let ok = false;
    let errorMessage = '';
    let resultBody = '';
    try {
      const res = await fastify.inject({
        method: 'POST',
        url: `${RUNTIME_PREFIX[job.runtime]}${job.function_name}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(job.payload ?? {}),
      });
      ok = res.statusCode >= 200 && res.statusCode < 300;
      resultBody = res.body;
      if (!ok) errorMessage = `Function responded ${res.statusCode}: ${res.body.slice(0, 500)}`;
    } catch (err) {
      errorMessage = (err as Error).message;
    }

    if (ok) {
      let result: unknown = null;
      try { result = JSON.parse(resultBody); } catch { result = resultBody; }
      await store.query(
        `UPDATE public.jobs SET status = 'done', error = NULL, result = $2, updated_at = now() WHERE id = $1`,
        [job.id, JSON.stringify(result)],
      ).catch(err => fastify.log.error(err, `job-queue: failed to mark job ${job.id} done`));
      return;
    }

    const attempts = job.attempts + 1;
    const nextStatus = attempts >= maxAttempts ? 'failed' : 'pending';
    await store.query(
      `UPDATE public.jobs SET status = $2, attempts = $3, error = $4, updated_at = now() WHERE id = $1`,
      [job.id, nextStatus, attempts, errorMessage],
    ).catch(err => fastify.log.error(err, `job-queue: failed to update job ${job.id} after error`));
    fastify.log.error(`job-queue: job ${job.id} (${job.function_name}) attempt ${attempts} failed: ${errorMessage}`);
  }

  async function drain(): Promise<void> {
    if (running) {
      rerunRequested = true;
      return;
    }
    running = true;
    try {
      while (!closed) {
        let job: QueuedJob | undefined;
        try {
          const result = await store.query<QueuedJob>(DEQUEUE_SQL);
          job = result.rows[0];
        } catch (err) {
          fastify.log.error(err, 'job-queue: dequeue failed');
          break;
        }
        if (!job) break;
        await processJob(job);
      }
    } finally {
      running = false;
    }
    if (rerunRequested && !closed) {
      rerunRequested = false;
      await drain();
    }
  }

  // POST /jobs/v1/:function_name — public job creation, open to any authenticated
  // caller (anon key, user JWT, or secret key), unlike the admin-only /tophbase/jobs.
  // Job *execution* still runs unauthenticated (see processJob above); only the
  // creation call is gated.
  fastify.post<{ Params: { function_name: string } }>('/jobs/v1/:function_name', {
    preHandler: [resolveLocalProject, authenticateProject],
  }, async (request, reply) => {
    const { function_name } = request.params;
    const body = createJobSchema.parse(request.body ?? {});
    const { functions, nodeFunctions } = fastify.config;

    const dir = body.runtime === 'edge' ? functions.dir : nodeFunctions.dir;
    if (!dir) {
      return reply.status(400).send({ error: { code: 'NOT_CONFIGURED', message: `${body.runtime === 'edge' ? 'Edge' : 'Node'} functions are not configured` } });
    }
    const available = body.runtime === 'edge' ? await listFunctions(dir, '') : await listNodeFunctions(dir, '');
    if (!available.some(f => f.name === function_name)) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `${body.runtime} function '${function_name}' not found` } });
    }

    const result = await store.query(
      `INSERT INTO public.jobs (function_name, runtime, payload)
       VALUES ($1, $2, $3)
       RETURNING id, function_name, runtime, payload, status, attempts, error, result, created_at, updated_at`,
      [function_name, body.runtime, JSON.stringify(body.payload)],
    );
    reply.status(201).send({ job: result.rows[0] });
  });

  const unlisten = await store.getPglite().listen('jobs_queue', () => {
    drain().catch(err => fastify.log.error(err, 'job-queue: drain failed'));
  });

  fastify.addHook('onClose', async () => {
    closed = true;
    await unlisten();
  });

  // Pick up any jobs that were queued while the server was offline.
  drain().catch(err => fastify.log.error(err, 'job-queue: initial drain failed'));
};

export default jobQueuePlugin;
