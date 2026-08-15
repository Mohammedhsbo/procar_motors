#!/bin/sh
# Daily backup loop for the compose backup service (24h interval).
set -eu
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
while true; do
  sh /scripts/backup.sh || echo "BACKUP_FAILED $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
  sleep "$INTERVAL"
done
