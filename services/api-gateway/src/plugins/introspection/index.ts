import type { FastifyPluginAsync } from 'fastify';
import { listenForSchemaChanges } from './inspector.js';

const introspectionPlugin: FastifyPluginAsync = async (fastify) => {
  // Start listening for schema changes
  listenForSchemaChanges(fastify.db).catch(err => {
    fastify.log.warn({ err }, 'Failed to set up schema change listener');
  });
};

export default introspectionPlugin;
