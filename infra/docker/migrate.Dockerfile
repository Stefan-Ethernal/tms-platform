# syntax=docker/dockerfile:1.7
FROM node:25-bookworm-slim AS build
# Installed here too (matching the runtime stage) so Prisma's postinstall detects the real
# OpenSSL version and fetches the matching engine at build time, instead of the query engine
# defaulting to openssl-1.1.x and trying to re-fetch/write itself at container start.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
# pnpm version from package.json#packageManager, the single place it is pinned.
COPY package.json ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tms/db..."
RUN pnpm --filter "@tms/db" deploy --legacy /out

FROM node:25-bookworm-slim AS runtime
# Prisma's schema engine needs OpenSSL on Debian slim images.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out .
USER node
# Phase 1 appends the permission sync: node dist/sync-permissions.js
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
