# Admin portal. Build from the project root:
#   docker build -f admin/Dockerfile --build-arg PUBLIC_API_URL=https://api.example.rw -t harvest-hold-admin .
FROM node:22-alpine AS build
WORKDIR /app
COPY admin/package.json admin/package-lock.json ./
RUN npm ci
COPY admin ./
# Shown in certificate previews (the public verify page); fixed at build time.
ARG PUBLIC_API_URL
ENV NEXT_PUBLIC_PUBLIC_API_URL=$PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
# ADMIN_API_URL: where this server reaches the API (private network), e.g. http://api:4000
CMD ["node", "server.js"]
