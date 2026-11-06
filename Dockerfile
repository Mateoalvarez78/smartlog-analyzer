# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps-prod
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY db/seed.ts ./db/seed.ts
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The official node:alpine image already ships a non-root `node` user
# (uid/gid 1000) for exactly this purpose — running as root inside the
# container has no upside here and is an unnecessary privilege to grant.
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=deps-prod /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node db/migrations ./db/migrations
COPY --chown=node:node docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh
USER node

EXPOSE 3000
ENTRYPOINT ["./docker/entrypoint.sh"]
