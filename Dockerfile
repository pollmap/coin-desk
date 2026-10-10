ARG NODE_IMAGE=node:24.18.0-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python-is-python3 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx \
    && groupadd -g 10001 coin-desk && useradd -u 10001 -g 10001 -M coin-desk
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
COPY --from=build /app/server ./server
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts/local-db.mjs ./scripts/local-db.mjs
COPY --from=build /app/scripts/backup_check.py /app/scripts/import_d1_export.py /app/scripts/vps_backup.py ./scripts/
USER 10001:10001
ENV HOST=0.0.0.0 PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["node","server/index.mjs"]
