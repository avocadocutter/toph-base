import type { FastifyRequest, FastifyReply } from 'fastify';

// In single-project mode, there's always exactly one project.
// The project ref and JWT secret come from the server config.
export async function resolveLocalProject(request: FastifyRequest, _reply: FastifyReply) {
  const { project } = request.server.config;
  request.project = {
    ref: project.name,
    jwtSecret: project.jwtSecret,
  };
  // Use the active branch's store so all queries hit the right database.
  request.projectDb = request.server.branchManager.getActiveStore();
}
