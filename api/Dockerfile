# Production image. Build from the project root so the crop profiles are included:
#   docker build -f api/Dockerfile -t harvest-hold-api .
FROM node:22-alpine AS build
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/.swcrc api/tsconfig.json ./
COPY api/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    CROP_PROFILES_DIR=/app/crop-profiles \
    FIRMWARE_DIR=/data/firmware \
    UPLOADS_DIR=/data/uploads
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY api/package.json ./
COPY api/migrations ./migrations
COPY crop-profiles ./crop-profiles
# Mount a volume on /data: firmware releases and photos must survive redeploys.
RUN mkdir -p /data/firmware /data/uploads && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
