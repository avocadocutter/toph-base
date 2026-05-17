import type { FastifyPluginAsync } from 'fastify';

// PGLite doesn't support LISTEN/NOTIFY, so schema change listening is a no-op.
// Cache invalidation happens explicitly after mutations (migrations, RLS changes).
const introspectionPlugin: FastifyPluginAsync = async (_fastify) => {
  // no-op in PGLite local mode
};

export default introspectionPlugin;
