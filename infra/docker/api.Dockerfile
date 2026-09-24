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
RUN pnpm --filter "@tms/${APP}" build \
 && pnpm --filter "@tms/${APP}" deploy --legacy --prod /out

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
CMD ["node", "dist/main.js"]
