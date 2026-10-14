#!/usr/bin/env bash
# Reverts to a previous release. Two independent levels:
#   1) code:  switch the current symlink to the previous (or a named) release
#   2) data:  restore a database dump — only with --restore-db <file> plus
#             CONFIRM=RESTORE_PRODUCTION, because it replaces live data.
# Usage: rollback.sh [--to <release-dir-or-timestamp>] [--restore-db <backup.sql.gz>] [--list]
set -euo pipefail

APP_ROOT=${APP_ROOT:-/opt/shomaldoc}
SERVICE_NAME=${SERVICE_NAME:-shomaldoc}
ENV_FILE=${ENV_FILE:-/etc/shomaldoc/app.env}
TO=""; RESTORE=""; LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --to) TO=$2; shift 2;;
    --restore-db) RESTORE=$2; shift 2;;
    --list) LIST=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done

if [ "$LIST" = "1" ]; then
  echo "current: $(readlink -f "$APP_ROOT/current" 2>/dev/null || echo none)"
  ls -1dt "$APP_ROOT/releases"/* 2>/dev/null | head -${KEEP_RELEASES:-5}
  exit 0
fi

CURRENT=$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)
if [ -z "$TO" ]; then
  TO=$(ls -1dt "$APP_ROOT/releases"/* 2>/dev/null | grep -v -F -x "$CURRENT" | head -1 || true)
fi
[ -n "$TO" ] || { echo "no previous release to roll back to" >&2; exit 1; }
[ -d "$TO" ] || { [ -d "$APP_ROOT/releases/$TO" ] && TO="$APP_ROOT/releases/$TO" || { echo "release not found: $TO" >&2; exit 1; }; }

echo "current: ${CURRENT:-none}"
echo "target:  $TO"
ln -sfn "$TO" "$APP_ROOT/current.tmp" && mv -Tf "$APP_ROOT/current.tmp" "$APP_ROOT/current"
bash "$(dirname "$0")/restart-service.sh" "$SERVICE_NAME"

BASE=${BASE_URL:-http://127.0.0.1:3080}
for i in $(seq 1 30); do
  curl -fsS "$BASE/api/health" | grep -q '"db":"up"' && { echo "rollback ok: now serving $TO"; break; }
  [ "$i" = "30" ] && { echo "rollback: service did not become healthy" >&2; exit 1; }
  sleep 2
done

if [ -n "$RESTORE" ]; then
  [ "${CONFIRM:-}" = "RESTORE_PRODUCTION" ] || { echo "--restore-db replaces live data; re-run with CONFIRM=RESTORE_PRODUCTION" >&2; exit 1; }
  set -a; . "$ENV_FILE"; set +a
  bash "$(dirname "$0")/restore-db.sh" "$RESTORE"
  bash "$(dirname "$0")/restart-service.sh" "$SERVICE_NAME"
  echo "database restored from $RESTORE"
fi
