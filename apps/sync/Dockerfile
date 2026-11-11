# Pekerja sinkronisasi Dapodik. Versi image Playwright harus sama dengan versi paket di package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY apps/sync/package.json ./
COPY apps/sync/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY apps/sync/src ./src
ENV NODE_ENV=production OUT_DIR=/data/out CACHE_DIR=/data/cache
VOLUME /data
CMD ["node", "src/run.mjs"]
