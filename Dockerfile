FROM node:20-alpine AS dashboard-builder
RUN corepack enable
WORKDIR /build/dashboard
COPY apps/dashboard/package.json apps/dashboard/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/dashboard/ ./
RUN pnpm build

FROM node:20-alpine AS api-builder
RUN corepack enable
WORKDIR /build/api
COPY apps/api/package.json apps/api/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/api/ ./
RUN pnpm build

FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app

COPY --from=api-builder /build/api/dist         ./apps/api/dist
COPY --from=api-builder /build/api/node_modules ./apps/api/node_modules
COPY --from=dashboard-builder /build/dashboard/dist ./apps/dashboard/dist
COPY migrations/ ./migrations/

EXPOSE 8000
CMD ["node", "apps/api/dist/index.js"]
