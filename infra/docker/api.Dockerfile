# syntax=docker/dockerfile:1.7
ARG APP
FROM node:24-bookworm-slim AS build
ARG APP
RUN npm install -g pnpm@12.5.1
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tms/${APP}..."
RUN pnpm --filter "@tms/${APP}" build \
 && pnpm --filter "@tms/${APP}" deploy --legacy --prod /out

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
CMD ["node", "dist/main.js"]
