FROM node:26-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS build
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM base AS prod-deps
RUN npm ci --omit=dev

# Final image: compiled code and production dependencies only, without compiler or tests.
FROM node:26-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY db ./db
USER node
EXPOSE 3000
# Run node directly, not through npm, so it receives SIGTERM and can shut down cleanly.
CMD ["node", "dist/server.js"]
