# Pekerja sinkronisasi Dapodik. Versi image Playwright harus sama dengan versi paket di package.json.
FROM mcr.microsoft.com/playwright:v1.50.1-noble
WORKDIR /app
COPY apps/sync/package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY apps/sync/src ./src
ENV NODE_ENV=production OUT_DIR=/data/out CACHE_DIR=/data/cache
VOLUME /data
CMD ["node", "src/run.mjs"]
