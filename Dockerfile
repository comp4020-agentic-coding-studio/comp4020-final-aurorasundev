# syntax = docker/dockerfile:1

# Builds the React client with Vite, then runs the Express server (TypeScript,
# run directly by node's type stripping). It serves HTTP on 0.0.0.0:$PORT
# (fly.toml sets PORT), the client at /, README.md rendered at /readme/, and
# keeps SQLite on the /data volume, opened at runtime, never at build time.

FROM docker.io/library/node:24.21.0-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN pnpm build && pnpm prune --prod

FROM docker.io/library/node:24.21.0-slim
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/throwaway.sqlite
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json README.md ./
COPY server ./server
# the private moderation CLI, run over `fly ssh console`
COPY scripts/moderation.ts ./scripts/moderation.ts
CMD ["node", "server/index.ts"]
