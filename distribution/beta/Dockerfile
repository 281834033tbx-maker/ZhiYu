# Build from the project root:
# docker build -f distribution/beta/Dockerfile -t zhiyu-beta:local .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json next.config.ts vite.config.ts ./
COPY desktop/package.json ./desktop/package.json
COPY app ./app
COPY components ./components
COPY hooks ./hooks
COPY lib ./lib
COPY server ./server
COPY scripts ./scripts
COPY public ./public
COPY npc-skills ./npc-skills
# The Node release does not use the personal Sites project or Cloudflare D1.
RUN node --input-type=module -e "import{mkdirSync,writeFileSync}from'node:fs';mkdirSync('.openai',{recursive:true});writeFileSync('.openai/hosting.json',JSON.stringify({d1:null,r2:null}));"
RUN npm run beta:build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100 ZHIYU_DATA_ROOT=/app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
# Vinext's production renderer remains a Node dependency. No development
# listener, source watcher or Cloudflare worker is started in this image.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/npc-skills ./npc-skills
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/server/npc/local-asr.py ./server/npc/local-asr.py
COPY --chown=node:node distribution/beta/backup.mjs ./distribution/beta/backup.mjs
RUN mkdir -p /app/.npc-runtime && chown node:node /app/.npc-runtime
USER node
VOLUME ["/app/.npc-runtime"]
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node","--input-type=module","-e","const r=await fetch('http://127.0.0.1:3100/healthz');if(!r.ok)process.exit(1);"]
CMD ["npm","run","beta:start"]
