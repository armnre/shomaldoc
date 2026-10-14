#!/usr/bin/env bash
# Restarts the app service. Root uses systemd; a non-root drill run (e.g. a
# staging copy under APP_ROOT) starts the server directly from the release, so
# the same scripts can be exercised without a systemd host.
set -euo pipefail
SERVICE_NAME=${1:-shomaldoc}
APP_ROOT=${APP_ROOT:-/opt/shomaldoc}
if [ "$(id -u)" -eq 0 ] && command -v systemctl >/dev/null 2>&1; then
  systemctl restart "$SERVICE_NAME"
  exit 0
fi
CURRENT=$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)
[ -n "$CURRENT" ] || { echo "no current release under $APP_ROOT" >&2; exit 1; }
PIDFILE="$APP_ROOT/run.pid"; LOG="$APP_ROOT/run.log"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then kill "$(cat "$PIDFILE")"; sleep 1; fi
mkdir -p "$APP_ROOT"
cd "$CURRENT"
set -a; [ -f "${ENV_FILE:-/etc/shomaldoc/app.env}" ] && . "${ENV_FILE:-/etc/shomaldoc/app.env}"; set +a
nohup "${NODE_BIN:-$APP_ROOT/node/current/bin}/node" node_modules/next/dist/bin/next start -H 127.0.0.1 -p "${PORT:-3080}" >>"$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "started pid $(cat "$PIDFILE") from $CURRENT (log: $LOG)"
