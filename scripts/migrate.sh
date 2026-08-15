#!/bin/sh
# Production migration — prisma migrate deploy only. Never db push.
set -eu
if [ "${1:-}" = "db" ] || [ "${1:-}" = "push" ] || [ "${2:-}" = "push" ]; then
  echo "Refusing unsafe Prisma command. Use migrate deploy only." >&2
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi
cd /app 2>/dev/null || cd "$(dirname "$0")/.."
if [ -x ./node_modules/.bin/prisma ]; then
  exec ./node_modules/.bin/prisma migrate deploy
fi
exec npx prisma migrate deploy
