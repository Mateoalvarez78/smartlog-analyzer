#!/bin/sh
set -e

echo "[entrypoint] running migrations..."
node dist/src/db/migrate.js

echo "[entrypoint] seeding demo data..."
node dist/db/seed.js

echo "[entrypoint] starting server..."
exec node dist/src/server.js
