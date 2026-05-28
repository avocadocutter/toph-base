import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { invalidateCache } from '../introspection/inspector.js';

const createBranchSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/, 'Branch name must be lowercase alphanumeric with hyphens'),
});

const mergeSchema = z.object({
  apply: z.array(z.string().min(1)).min(1),
});

const branchesPlugin: FastifyPluginAsync = async (fastify) => {
  const mgr = fastify.branchManager;

  fastify.get('/admin/branches', async () => {
    return {
      activeBranch: mgr.getActiveBranch(),
      branches: mgr.listBranches(),
    };
  });

  fastify.post('/admin/branches', async (request: FastifyRequest, reply) => {
    const body = createBranchSchema.parse(request.body);
    try {
      const branch = await mgr.createBranch(body.name);
      reply.status(201).send(branch);
    } catch (err) {
      throw new BadRequestError((err as Error).message);
    }
  });

  fastify.post('/admin/branches/:name/switch', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    try {
      await mgr.switchBranch(name);
    } catch (err) {
      throw new NotFoundError((err as Error).message);
    }
    invalidateCache('*');
    return { activeBranch: name };
  });

  fastify.delete('/admin/branches/:name', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    try {
      await mgr.deleteBranch(name);
    } catch (err) {
      throw new BadRequestError((err as Error).message);
    }
    return { deleted: name };
  });

  fastify.post('/admin/branches/:name/reset', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    try {
      await mgr.resetBranch(name);
    } catch (err) {
      throw new BadRequestError((err as Error).message);
    }
    invalidateCache('*');
    return { reset: name };
  });

  fastify.get('/admin/branches/:name/diff', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    if (name === 'main') {
      return { additions: [], warnings: [] };
    }
    try {
      const diff = await mgr.getSchemaDiff(name);
      return diff;
    } catch (err) {
      throw new BadRequestError((err as Error).message);
    }
  });

  fastify.post('/admin/branches/:name/merge', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    if (name === 'main') throw new BadRequestError('Cannot merge main into itself');
    const body = mergeSchema.parse(request.body);
    try {
      await mgr.applyDiffToMain(body.apply);
    } catch (err) {
      throw new BadRequestError(`Merge failed: ${(err as Error).message}`);
    }
    invalidateCache('*');
    return { merged: name, applied: body.apply.length };
  });
};

export default branchesPlugin;
