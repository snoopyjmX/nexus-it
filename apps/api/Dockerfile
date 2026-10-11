# syntax=docker/dockerfile:1
# Tag de versão maior; fixar por digest na Fase 5 (hardening).
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @nexus/api
COPY apps/api apps/api
RUN pnpm --filter @nexus/api build \
 && cp -r apps/api/src/db/migrations apps/api/dist/db/migrations \
 && pnpm --filter @nexus/api deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/v1/health/live || exit 1
CMD ["node", "dist/server.js"]
