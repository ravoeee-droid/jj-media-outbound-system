FROM node:24-bookworm-slim
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=true DATA_DIR=/data CHROME_PATH=/usr/bin/chromium
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation ffmpeg tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
# The published OpenWA package contains dist/. Skip install hooks and browser downloads.
RUN npm install --omit=dev --ignore-scripts
COPY core.mjs server.mjs ./
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.mjs"]
