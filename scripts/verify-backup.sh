#!/bin/sh
# Restore latest dump into a temporary database, then drop it.
# Does not touch the live PGDATABASE.
set -eu
: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}"
DIR="${BACKUP_DIR:-/backups}"
LATEST=$(ls -1t "${DIR}"/pro_motors_*.sql.gz 2>/dev/null | head -1 || true)
if [ -z "$LATEST" ]; then
  echo "No backup files in ${DIR}" >&2
  exit 1
fi
VERIFY_DB="${PGDATABASE}_restore_verify"
dropdb --if-exists "$VERIFY_DB"
createdb "$VERIFY_DB"
gunzip -c "$LATEST" | psql -v ON_ERROR_STOP=1 -d "$VERIFY_DB" >/dev/null
psql -d "$VERIFY_DB" -c "SELECT 1" >/dev/null
dropdb "$VERIFY_DB"
echo "BACKUP_RESTORE_VERIFY_OK ${LATEST}"
