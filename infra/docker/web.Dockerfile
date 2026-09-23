# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /repo
# pnpm version from package.json#packageManager, the single place it is pinned.
COPY package.json ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tms/web-admin..." --filter "@tms/web-driver..."
RUN pnpm --filter "@tms/web-admin" --filter "@tms/web-driver" build

FROM caddy:2-alpine
COPY infra/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web-admin/dist /srv/web-admin
COPY --from=build /repo/apps/web-driver/dist /srv/web-driver
