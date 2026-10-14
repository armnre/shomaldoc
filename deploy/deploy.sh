#!/usr/bin/env bash
# Release deploy: copy -> npm ci -> build -> backup -> migrate -> seed -> bootstrap -> switch -> restart -> health.
# On health failure the previous release is restored automatically.
set -euo pipefail
SOURCE_DIR=${1:?usage: deploy.sh <source-checkout-dir>}
APP=/opt/shomaldoc; RELEASES=$APP/releases; CURRENT=$APP/current
ENV_FILE=/etc/shomaldoc/app.env; NODE_BIN=$APP/node/current/bin
export PATH="$NODE_BIN:$PATH"
node -v | grep -q '^v22\.' || { echo "Node 22 required (run install-node.sh)"; exit 1; }
set -a; . "$ENV_FILE"; set +a
TS=$(date -u +%Y%m%d%H%M%S); NEW=$RELEASES/$TS
PREV=$(readlink -f "$CURRENT" 2>/dev/null || true)
mkdir -p "$RELEASES" "$APP/shared/storage/uploads"
mkdir -p "$NEW"
(cd "$SOURCE_DIR" && tar --exclude=./node_modules --exclude=./.git --exclude=./.next -cf - .) | (cd "$NEW" && tar -xf -)
cd "$NEW"
# The service user must own the release (build cache, logs, uploads symlink).
if [ "$(id -u)" -eq 0 ]; then
  chown -R shomaldoc:shomaldoc "$NEW"
fi
# A writable build cache prevents EACCES failures under systemd hardening.
mkdir -p "$NEW/.next/cache"
if [ "$(id -u)" -eq 0 ]; then chown -R shomaldoc:shomaldoc "$NEW/.next/cache"; fi
npm ci --no-audit --no-fund
npm run build
bash deploy/backup-db.sh
npm run db:migrate
npm run db:seed-rbac
# Bootstrap is a critical step: its failure must abort the deploy, never be swallowed.
if [ -f "${BOOTSTRAP_FILE:-/etc/shomaldoc/bootstrap.env}" ]; then
  echo "bootstrap: creating initial administrator (one-time)"
  if ! npm run admin:bootstrap; then
    echo "bootstrap FAILED; aborting deploy (no silent continuation)" >&2
    exit 1
  fi
else
  echo "bootstrap: no bootstrap file, skipping (an administrator must already exist)"
fi
ln -sfn "$APP/shared/storage" "$NEW/storage"
ln -sfn "$NEW" "$CURRENT.tmp" && mv -Tf "$CURRENT.tmp" "$CURRENT"
systemctl restart shomaldoc
SMOKE_OK=0
for i in $(seq 1 30); do
  HEALTH=$(curl -fsS http://127.0.0.1:3080/api/health || true)
  if echo "$HEALTH" | grep -q '"ok":true' && echo "$HEALTH" | grep -q '"db":"up"'; then
    # Smoke: the login page must render and the API must answer 401 without a session.
    PAGE_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/login || echo 000)
    API_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/api/cases || echo 000)
    if [ "$PAGE_CODE" = "200" ] && [ "$API_CODE" = "401" ]; then
      SMOKE_OK=1
    else
      echo "smoke: login=$PAGE_CODE api=$API_CODE (expected 200/401)" >&2
    fi
    if [ "$SMOKE_OK" = "1" ]; then
    echo "deploy ok: $TS (health + smoke passed)"
    ls -1dt "$RELEASES"/* | tail -n +6 | xargs -r rm -rf --
    bash "$(dirname "$0")/post-deploy-check.sh" || echo "post-deploy-check reported issues" >&2
    exit 0
    fi
  fi
  sleep 2
done
echo "health check failed; rolling back to ${PREV:-none}"
if [ -n "$PREV" ] && [ -d "$PREV" ]; then
  ln -sfn "$PREV" "$CURRENT.tmp" && mv -Tf "$CURRENT.tmp" "$CURRENT"
  systemctl restart shomaldoc
fi
exit 1
