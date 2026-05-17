import type { FastifyRequest, FastifyReply } from 'fastify';

// In single-project mode, there's always exactly one project.
// The project ref and JWT secret come from the server config.
export async function resolveLocalProject(request: FastifyRequest, _reply: FastifyReply) {
  const { project } = request.server.config;
  request.project = {
    ref: project.name,
    jwtSecret: project.jwtSecret,
  };
  // In single-project mode, fastify.db IS the project database.
  request.projectDb = request.server.db;
}
