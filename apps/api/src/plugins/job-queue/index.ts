import type { FastifyPluginAsync } from 'fastify';
import type { PGliteStore } from '../../db/pglite-store.js';

export interface JobQueueOptions {
  store: PGliteStore;
  maxAttempts?: number;
}

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
  const { store, maxAttempts = 5 } = opts;

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
