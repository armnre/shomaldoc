#!/usr/bin/env bash
# Upgrade an existing installation from an offline package, with automatic rollback.
#
# verify -> backup database AND uploads -> extract -> migrate -> switch -> restart
# -> health. If health fails, the previous release is restored and the newly
# applied migrations are reported (they are additive: no data is lost by staying up).
#
# Usage: bash upgrade-offline.sh <package.tar.gz>
set -euo pipefail

PKG=${1:?usage: upgrade-offline.sh <package.tar.gz>}
APP_ROOT=${APP_ROOT:-/opt/shomaldoc}
ENV_FILE=${ENV_FILE:-/etc/shomaldoc/app.env}
SERVICE_NAME=${SERVICE_NAME:-shomaldoc}
NODE_BIN=${NODE_BIN:-$APP_ROOT/node/current/bin}
KEEP_RELEASES=${KEEP_RELEASES:-5}
TARBALL=$(readlink -f "$PKG")
[ -f "$TARBALL" ] || { echo "no such package: $PKG" >&2; exit 1; }
export PATH="$NODE_BIN:$PATH"
"$NODE_BIN/node" -v | grep -q '^v22\.' || { echo "Node 22 required" >&2; exit 1; }

echo "== 1/7 verify checksum"
if [ -f "$TARBALL.sha256" ]; then ( cd "$(dirname "$TARBALL")" && sha256sum -c "$(basename "$TARBALL").sha256" ); fi

set -a; . "$ENV_FILE"; set +a
DB_BACKUP=$(bash "$(dirname "$0")/backup-db.sh" | awk '{print $3}')
UP_BACKUP=$(bash "$(dirname "$0")/backup-uploads.sh" | awk '{print $3}')
echo "backups: db=$DB_BACKUP uploads=$UP_BACKUP"

echo "== 2/7 extract the new release"
WORK=$(mktemp -d); tar -xzf "$TARBALL" -C "$WORK"
SRC=$(find "$WORK" -maxdepth 1 -mindepth 1 -type d | head -1)
TS=$(date -u +%Y%m%d%H%M%S); REL="$APP_ROOT/releases/$TS"
PREV=$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)
[ -e "$REL" ] && { echo "$REL already exists" >&2; exit 1; }
mv "$SRC" "$REL"; rm -rf "$WORK"
ln -sfn "$APP_ROOT/shared/storage" "$REL/storage"
if [ "$(id -u)" -eq 0 ]; then chown -R "$SERVICE_NAME:$SERVICE_NAME" "$REL"; fi
cd "$REL"

echo "== 3/7 migrations (additive only)"
npm run db:migrate
npm run db:seed-rbac
npm run db:seed-forms
npm run db:seed-prod

echo "== 4/7 switch the current symlink"
ln -sfn "$REL" "$APP_ROOT/current.tmp" && mv -Tf "$APP_ROOT/current.tmp" "$APP_ROOT/current"

echo "== 5/7 restart the service"
bash "$(dirname "$0")/restart-service.sh" "$SERVICE_NAME"

echo "== 6/7 health + smoke"
BASE=${BASE_URL:-http://127.0.0.1:3080}
OK=0
for i in $(seq 1 30); do
  HEALTH=$(curl -fsS "$BASE/api/health" || true)
  if echo "$HEALTH" | grep -q '"db":"up"'; then
    P=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/login" || echo 000)
    A=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/cases" || echo 000)
    [ "$P" = "200" ] && [ "$A" = "401" ] && { OK=1; break; }
    echo "smoke: login=$P api=$A (expected 200/401)" >&2
  fi
  sleep 2
done

if [ "$OK" != "1" ]; then
  echo "upgrade FAILED health checks; rolling back to ${PREV:-none}" >&2
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    ln -sfn "$PREV" "$APP_ROOT/current.tmp" && mv -Tf "$APP_ROOT/current.tmp" "$APP_ROOT/current"
    bash "$(dirname "$0")/restart-service.sh" "$SERVICE_NAME"
    echo "rolled back; database backups: $DB_BACKUP $UP_BACKUP" >&2
    echo "migrations already applied are additive; if data repair is required use deploy/rollback.sh --restore-db <backup>" >&2
  fi
  exit 1
fi

echo "== 7/7 housekeeping"
ls -1dt "$APP_ROOT/releases"/* 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf --
bash "$(dirname "$0")/post-deploy-check.sh" || { echo "post-deploy-check reported issues" >&2; exit 1; }
echo "upgrade ok: release $TS from $(basename "$TARBALL")"
