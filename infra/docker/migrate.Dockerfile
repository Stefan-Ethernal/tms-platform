# syntax=docker/dockerfile:1.7
FROM node:26-bookworm-slim AS build
# OpenSSL here too (matching the runtime stage): the @prisma/engines postinstall detects the
# OpenSSL version and downloads the matching schema engine at build time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
# pnpm version from package.json#packageManager, the single place it is pinned.
COPY package.json ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tms/db..."
# The Prisma client first, then topological builds (@tms/contracts, then @tms/db). --prod keeps the
# optional Prisma CLI and drops every devDependency.
RUN pnpm --filter "@tms/db" run generate \
 && pnpm --filter "@tms/db..." run build \
 && pnpm --filter "@tms/db" deploy --legacy --prod /out

FROM node:26-bookworm-slim AS runtime
# The schema engine behind `prisma migrate deploy` links against OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production CHECKPOINT_DISABLE=1
WORKDIR /app
# Root-owned on purpose (deviation 10): the runtime user cannot rewrite its own code.
COPY --from=build /out .
USER node
# D12 + deviation 5: migrations, then the create-only seed, which runs the permission sync first.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --config ./prisma.config.ts && exec node dist/cli/seed.js"]
