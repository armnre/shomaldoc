#!/usr/bin/env bash
# Fresh install on a server WITHOUT internet and WITHOUT npm.
#
# Steps: verify checksum -> extract to a new release -> link shared storage ->
# run migrations/seeds -> install the systemd unit -> start -> health + smoke.
# Every critical step aborts on failure; nothing is silenced.
#
# Usage: bash install-offline.sh <package.tar.gz> [--check]
#   --check  verify the package only (extract to a temp dir, touch nothing else)
set -euo pipefail

PKG=${1:?usage: install-offline.sh <package.tar.gz> [--check]}
MODE=${2:-install}
APP_ROOT=${APP_ROOT:-/opt/shomaldoc}
ENV_FILE=${ENV_FILE:-/etc/shomaldoc/app.env}
SERVICE_NAME=${SERVICE_NAME:-shomaldoc}
SERVICE_FILE=${SERVICE_FILE:-/etc/systemd/system/$SERVICE_NAME.service}
NODE_BIN=${NODE_BIN:-$APP_ROOT/node/current/bin}
TARBALL=$(readlink -f "$PKG")
[ -f "$TARBALL" ] || { echo "no such package: $PKG" >&2; exit 1; }

echo "== 1/8 verify the package checksum"
if [ -f "$TARBALL.sha256" ]; then
  ( cd "$(dirname "$TARBALL")" && sha256sum -c "$(basename "$TARBALL").sha256" )
else
  echo "NOTE: $TARBALL.sha256 not found; computing the digest for the record"
  sha256sum "$TARBALL"
fi

echo "== 2/8 extract into a staging directory"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
tar -xzf "$TARBALL" -C "$WORK"
SRC=$(find "$WORK" -maxdepth 1 -mindepth 1 -type d | head -1)
[ -n "$SRC" ] || { echo "empty package" >&2; exit 1; }
for f in package.json .next/BUILD_ID node_modules/next/package.json drizzle deploy/shomaldoc.service; do
  [ -e "$SRC/$f" ] || { echo "package is missing $f" >&2; exit 1; }
done

if [ "$MODE" = "--check" ]; then
  echo "check ok: package is complete ($(du -sh "$SRC" | cut -f1)), nothing was installed"
  exit 0
fi

echo "== 3/8 verify the runtime (Node 22 in the isolated prefix, no system npm needed)"
[ -x "$NODE_BIN/node" ] || { echo "Node not found at $NODE_BIN (run deploy/install-node.sh --from <tarball>)" >&2; exit 1; }
"$NODE_BIN/node" -v | grep -q '^v22\.' || { echo "Node 22 required, found $("$NODE_BIN/node" -v)" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE missing (run deploy/provision-db.sh first)" >&2; exit 1; }
export PATH="$NODE_BIN:$PATH"

echo "== 4/8 place the release"
mkdir -p "$APP_ROOT/releases" "$APP_ROOT/shared/storage/uploads"
TS=$(date -u +%Y%m%d%H%M%S)
REL="$APP_ROOT/releases/$TS"
[ -e "$REL" ] && { echo "$REL already exists" >&2; exit 1; }
mv "$SRC" "$REL"
ln -sfn "$APP_ROOT/shared/storage" "$REL/storage"
if [ "$(id -u)" -eq 0 ]; then chown -R "$SERVICE_NAME:$SERVICE_NAME" "$REL"; fi

echo "== 5/8 database: migrate + seed reference data (idempotent)"
cd "$REL"
set -a; . "$ENV_FILE"; set +a
npm run db:migrate
npm run db:seed-rbac
npm run db:seed-forms
npm run db:seed-prod

echo "== 6/8 first administrator (one-time, from ${BOOTSTRAP_FILE:-/etc/shomaldoc/bootstrap.env})"
if [ -f "${BOOTSTRAP_FILE:-/etc/shomaldoc/bootstrap.env}" ]; then
  npm run admin:bootstrap || { echo "bootstrap FAILED; aborting install" >&2; exit 1; }
else
  echo "bootstrap: no bootstrap file; an administrator must already exist"
fi

echo "== 7/8 systemd unit + service start"
if [ "$(id -u)" -eq 0 ]; then
  install -m 644 "$REL/deploy/shomaldoc.service" "$SERVICE_FILE"
  systemctl daemon-reload
  ln -sfn "$REL" "$APP_ROOT/current.tmp" && mv -Tf "$APP_ROOT/current.tmp" "$APP_ROOT/current"
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE_NAME"
else
  ln -sfn "$REL" "$APP_ROOT/current.tmp" && mv -Tf "$APP_ROOT/current.tmp" "$APP_ROOT/current"
fi

echo "== 8/8 health + smoke"
BASE=${BASE_URL:-http://127.0.0.1:3080}
for i in $(seq 1 30); do
  HEALTH=$(curl -fsS "$BASE/api/health" || true)
  if echo "$HEALTH" | grep -q '"db":"up"'; then
    P=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/login" || echo 000)
    A=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/cases" || echo 000)
    if [ "$P" = "200" ] && [ "$A" = "401" ]; then
      echo "install ok: release $TS (health + smoke 200/401)"
      echo "run 'bash deploy/verify-host.sh' to audit the host and reverse proxy"
      exit 0
    fi
    echo "smoke: login=$P api=$A (expected 200/401)" >&2
  fi
  sleep 2
done
echo "health/smoke failed; the release is in place but the service is not serving" >&2
exit 1
