# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:22.17.0-bookworm-slim@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /workspace

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY programs/arena/package.json programs/arena/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .

RUN pnpm --filter @arena/contracts build \
    && pnpm --filter @arena/auth build \
    && pnpm --filter @arena/web build \
    && pnpm --filter @arena/api build \
    && pnpm --filter @arena/api deploy --prod /prod/app

FROM node:22.17.0-bookworm-slim@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0 AS runtime

ARG VCS_REF=local
LABEL org.opencontainers.image.source="https://github.com/AndriyZaec/SABG" \
      org.opencontainers.image.revision=$VCS_REF

ENV NODE_ENV=production \
    PORT=4000 \
    WEB_DIST_DIR=/app/web

WORKDIR /app

COPY --from=build --chown=node:node /prod/app/ ./
COPY --from=build --chown=node:node /workspace/apps/web/dist/ ./web/

RUN mkdir -p /app/audit && chown node:node /app/audit

USER node

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/gateway/demo-cycle.js"]
