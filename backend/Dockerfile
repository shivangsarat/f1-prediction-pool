FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production API_PORT=3001 HOST=0.0.0.0 DB_PATH=/app/data/pool.sqlite BACKUP_DIR=/app/backups
COPY package.json ./
COPY src/ ./src/
RUN mkdir -p /app/data /app/backups && chown -R node:node /app
USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
CMD ["node","--experimental-strip-types","src/server.ts"]
