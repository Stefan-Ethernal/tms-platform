# syntax=docker/dockerfile:1.7
ARG APP
FROM node:26-bookworm-slim AS build
ARG APP
WORKDIR /repo
# pnpm version from package.json#packageManager, the single place it is pinned.
COPY package.json ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tms/${APP}..."
# Workspace dependencies first (topological), then the app. --no-optional keeps the Prisma CLI,
# an optional dependency of @tms/db once the API imports it, out of the image.
RUN pnpm --filter "@tms/${APP}..." run --if-present generate \
 && pnpm --filter "@tms/${APP}..." run build \
 && pnpm --filter "@tms/${APP}" deploy --legacy --prod --no-optional /out

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production LOG_DIR=/var/log/tms
# A new `logs` volume is initialised from this directory, ownership included (D14).
RUN mkdir -p /var/log/tms && chown node:node /var/log/tms
WORKDIR /app
# Root-owned on purpose (deviation 10): the writable paths are LOG_DIR and /tmp.
COPY --from=build /out .
ARG GIT_SHA=dev
ENV SENTRY_RELEASE=${GIT_SHA}
USER node
CMD ["node", "dist/main.js"]
