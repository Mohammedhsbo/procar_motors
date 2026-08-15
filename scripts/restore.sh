#!/bin/sh
# Restore a gzip SQL dump. Requires CONFIRM_RESTORE=YES.
# Does not run unless explicitly confirmed — production data safety.
set -eu
FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "usage: restore.sh <backup.sql.gz>" >&2
  exit 1
fi
if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo "Refusing restore. Set CONFIRM_RESTORE=YES" >&2
  exit 1
fi
: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}"
gunzip -c "$FILE" | psql -v ON_ERROR_STOP=1
echo "RESTORE_OK ${FILE}"
