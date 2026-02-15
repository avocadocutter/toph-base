import type { FastifyPluginAsync } from 'fastify';
import { introspectSchema, listenForSchemaChanges } from './inspector.js';

const introspectionPlugin: FastifyPluginAsync = async (fastify) => {
  // Start listening for schema changes
  listenForSchemaChanges(fastify.db).catch(err => {
    fastify.log.warn({ err }, 'Failed to set up schema change listener');
  });

  // Pre-warm the cache
  try {
    await introspectSchema(fastify.db);
    fastify.log.info('Schema introspection cache warmed');
  } catch (err) {
    fastify.log.warn({ err }, 'Failed to warm schema cache');
  }
};

export default introspectionPlugin;
