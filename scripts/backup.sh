#!/bin/sh
# PostgreSQL logical backup (pg_dump | gzip). Intended to run in the backup container.
set -eu
: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}"
DIR="${BACKUP_DIR:-/backups}"
mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="${DIR}/pro_motors_${STAMP}.sql.gz"
pg_dump --no-owner --format=plain | gzip > "$FILE"
# Retain 14 days
find "$DIR" -name 'pro_motors_*.sql.gz' -mtime +14 -delete 2>/dev/null || true
echo "BACKUP_OK ${FILE}"
