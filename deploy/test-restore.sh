#!/usr/bin/env bash
# Restores the newest backup into a throw-away database, verifies core tables, then drops it.
set -euo pipefail
ADMIN_URL=${ADMIN_DATABASE_URL:?set ADMIN_DATABASE_URL (superuser URL to 'postgres' db)}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/shomaldoc}
LATEST=$(ls -1t "$BACKUP_DIR"/shomaldoc-*.sql.gz | head -1)
TMP_DB="shomaldoc_restore_test_$(date -u +%s)"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $TMP_DB"
trap 'psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $TMP_DB" || true' EXIT
TARGET="${ADMIN_URL%/*}/$TMP_DB"
TARGET_DATABASE_URL="$TARGET" bash "$(dirname "$0")/restore-db.sh" "$LATEST"
for t in users roles permissions role_permissions user_roles sessions audit_logs settings; do
  n=$(psql "$TARGET" -tAc "select count(*) from $t")
  echo "table $t rows=$n"
done
echo "test-restore OK from $(basename "$LATEST")"
