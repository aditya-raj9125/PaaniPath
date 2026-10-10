FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tests ./tests
COPY infra ./infra
COPY README.md ./README.md
COPY docs ./docs
RUN npm ci --ignore-scripts && npm run check

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/.data/ncr-seeded DEMO_MODE=false SEED_MODE=true
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/.data"]
CMD ["node", "dist/server.mjs"]
