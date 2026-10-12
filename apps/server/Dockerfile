# Una sola imagen para los cuatro procesos (api, ingest, worker, notifier) y los jobs (migrate,
# mqtt-bootstrap, seed). El proceso se elige con el comando: `node src/main/api.ts`, etc.
# Contexto de construcción: la raíz del repositorio.
#
# Node 24 ejecuta TypeScript directamente (type stripping), así que no hay paso de compilación.
# Imagen base fijada por digest; el bot de dependencias la actualiza.
ARG NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

FROM ${NODE_IMAGE} AS base
RUN corepack enable
WORKDIR /app

# Manifiestos: la capa de dependencias solo se reconstruye si cambian.
FROM base AS manifiestos
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/server/package.json apps/server/
COPY tools/simulator/package.json tools/simulator/

FROM manifiestos AS deps-prod
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@lympha/server..."

# ---- desarrollo: dependencias completas; el código se sincroniza con `docker compose watch` ----
FROM manifiestos AS dev
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter "@lympha/server..."
COPY packages/contracts/ packages/contracts/
COPY apps/server/ apps/server/
WORKDIR /app/apps/server
USER node
ENTRYPOINT ["node"]

# ---- producción: solo dependencias de producción, sin raíz de escritura ----
FROM base AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION}
COPY --from=deps-prod /app /app
COPY packages/contracts/ packages/contracts/
COPY apps/server/src/ apps/server/src/
COPY apps/server/migrations/ apps/server/migrations/
WORKDIR /app/apps/server
USER node
ENTRYPOINT ["node"]
CMD ["src/main/api.ts"]
