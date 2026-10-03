FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS toolchain
WORKDIR /app
# Bootstrap only the pinned package manager, with all of its lifecycle hooks disabled.
RUN npm install --global npm@12.1.0 --ignore-scripts && test "$(npm --version)" = 12.1.0

FROM toolchain AS web
ARG FEEDFOLD_BASE_PATH=/
COPY .npmrc ./
COPY environments/web/package.json environments/web/package-lock.json ./
COPY scripts/verify-dependencies.mjs ./scripts/
RUN npm ci && node scripts/verify-dependencies.mjs web
COPY . .
RUN npm run build:client && npm run build:demo

FROM toolchain AS native-build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

FROM native-build AS server
COPY .npmrc ./
COPY environments/server/package.json environments/server/package-lock.json ./
COPY scripts/verify-dependencies.mjs ./scripts/
RUN npm ci && node scripts/verify-dependencies.mjs server
COPY . .
RUN npm run build:server

FROM native-build AS production-dependencies
COPY .npmrc ./
COPY environments/server/package.json environments/server/package-lock.json ./
COPY scripts/verify-dependencies.mjs ./scripts/
RUN npm ci --omit=dev && node scripts/verify-dependencies.mjs server --omit-dev

FROM toolchain AS browser-runtime
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Keep browser downloads independent of application dependencies and source changes.
RUN npm install --prefix /opt/browser --ignore-scripts --no-package-lock playwright@1.62.0 \
    && node /opt/browser/node_modules/playwright/cli.js install --with-deps --only-shell chromium \
    && rm -rf /opt/browser /var/lib/apt/lists/* \
    && chown -R node:node /ms-playwright

FROM browser-runtime AS runtime
ARG FEEDFOLD_BASE_PATH=/
ENV NODE_ENV=production \
    FEEDFOLD_BASE_PATH=$FEEDFOLD_BASE_PATH \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/feedfold.db
COPY --from=production-dependencies --chown=node:node /app/package.json /app/package-lock.json /app/.npmrc ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/scripts ./scripts
RUN mkdir -p /data && chown node:node /data
COPY --from=web --chown=node:node /app/dist/client ./dist/client
COPY --from=web --chown=node:node /app/dist/demo ./dist/demo
COPY --from=server --chown=node:node /app/dist/server ./dist/server
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["node", "dist/server/index.js"]
