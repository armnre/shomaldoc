#!/usr/bin/env bash
# Restore drill: proves a backup set is restorable WITHOUT touching production.
# Database -> throw-away database on the same server; uploads -> throw-away dir.
# Verifies row counts of core tables and that every referenced file exists.
# Usage: ADMIN_DATABASE_URL=postgres://... bash test-restore-all.sh [backup-dir]
set -euo pipefail
DIR=$(dirname "$0")
BACKUP_DIR=${1:-${BACKUP_DIR:-/var/backups/shomaldoc}}
ADMIN_URL=${ADMIN_DATABASE_URL:?set ADMIN_DATABASE_URL (superuser URL, for CREATE DATABASE only)}
DB=$(ls -1t "$BACKUP_DIR"/shomaldoc-*.sql.gz | grep -v uploads | head -1)
UP=$(ls -1t "$BACKUP_DIR"/shomaldoc-uploads-*.tar.gz | head -1)
[ -n "$DB" ] && [ -n "$UP" ] || { echo "need both a database and an uploads backup in $BACKUP_DIR" >&2; exit 1; }
echo "drill with: $(basename "$DB") + $(basename "$UP")"

TMP_DB="shomaldoc_restore_test_$(date -u +%s)"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $TMP_DB"
trap 'psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $TMP_DB" || true; rm -rf "${TMP_UP:-}"' EXIT
TARGET="${ADMIN_URL%/*}/$TMP_DB"
TARGET_DATABASE_URL="$TARGET" bash "$DIR/restore-db.sh" "$DB"
for t in users roles permissions role_permissions user_roles audit_logs settings thesis_cases notifications; do
  n=$(psql "$TARGET" -tAc "select count(*) from $t")
  echo "table $t rows=$n"
done

TMP_UP=$(mktemp -d)
TARGET_DIR="$TMP_UP/uploads" bash "$DIR/restore-uploads.sh" "$UP"
FILES=$(find "$TMP_UP/uploads" -type f | wc -l)
BYTES=$(du -sh "$TMP_UP/uploads" | cut -f1)
[ "$FILES" -gt 0 ] || { echo "uploads restore produced no files" >&2; exit 1; }
echo "uploads restored: $FILES files, $SIZE bytes=$BYTES"

# Every file row in the restored database must have its bytes on disk.
MISSING=$(psql "$TARGET" -tAc "select storage_key from files" | while read -r k; do
  [ -z "$k" ] && continue
  [ -f "$TMP_UP/uploads/$(basename "$k")" ] || echo "$k"
done | wc -l)
echo "file rows without restored bytes: $MISSING"
[ "$MISSING" -eq 0 ] || { echo "restore drill FAILED: $MISSING files missing" >&2; exit 1; }
echo "restore drill OK (database + uploads, integrity verified)"
