# Node 22+ has built-in SQLite. Keep both API and website on one small server.
FROM node:22-alpine AS web-builder
WORKDIR /app
COPY package.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --no-audit --no-fund
COPY packages/core packages/core
COPY apps/web apps/web
RUN npm run build -w @f1/web

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DB_PATH=/app/data/pool.sqlite BACKUP_DIR=/app/backups
COPY package.json ./
COPY packages/core packages/core
COPY apps/api apps/api
COPY --from=web-builder /app/apps/web/dist apps/web/dist
RUN mkdir -p /app/data /app/backups && chown -R node:node /app
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
CMD ["node","--experimental-strip-types","apps/api/src/server.ts"]
