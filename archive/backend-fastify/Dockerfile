# Production image. Build from the project root so the crop profiles are included:
#   docker build -f backend/Dockerfile -t harvest-hold-api .
FROM node:22-alpine AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production CROP_PROFILES_DIR=/app/crop-profiles FIRMWARE_DIR=/data/firmware
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend/package.json ./
COPY backend/migrations ./migrations
COPY crop-profiles ./crop-profiles
# Mount a volume on /data so firmware releases survive redeploys.
RUN mkdir -p /data/firmware && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/server.js"]
