#!/usr/bin/env bash
# Restores a backup into TARGET_DATABASE_URL. Refuses to target the live DATABASE_URL unless CONFIRM=RESTORE_PRODUCTION.
set -euo pipefail
FILE=${1:?usage: restore-db.sh <backup.sql.gz>}
: "${TARGET_DATABASE_URL:?set TARGET_DATABASE_URL}"
if [ -n "${DATABASE_URL:-}" ] && [ "$TARGET_DATABASE_URL" = "$DATABASE_URL" ] && [ "${CONFIRM:-}" != "RESTORE_PRODUCTION" ]; then
  echo "refusing to restore into the live database without CONFIRM=RESTORE_PRODUCTION"; exit 1
fi
gzip -t "$FILE"
gunzip -c "$FILE" | psql -v ON_ERROR_STOP=1 -q "$TARGET_DATABASE_URL"
echo "restore finished into target"
