#!/usr/bin/env bash
# Read-only verification after a deploy. Exits non-zero when anything is wrong.
set -uo pipefail
BASE=${BASE_URL:-http://127.0.0.1:3080}
FAIL=0
check() { # name, expected, actual
  if [ "$2" = "$3" ]; then echo "ok   $1 = $3"; else echo "FAIL $1 expected=$2 actual=$3"; FAIL=1; fi
}

HEALTH=$(curl -fsS "$BASE/api/health" 2>/dev/null || echo '{}')
echo "$HEALTH" | grep -q '"ok":true' && check "health.ok" "true" "true" || check "health.ok" "true" "false"
echo "$HEALTH" | grep -q '"db":"up"' && check "health.db" "up" "up" || check "health.db" "up" "down"

check "login page" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/login")"
check "manifest" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/manifest.webmanifest")"
check "sw.js" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/sw.js")"
check "icon-192" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/icons/icon-192.png")"
check "icon-512" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/icons/icon-512.png")"
check "university logo" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/branding/university-logo.jpg")"
# Private APIs must reject anonymous callers.
check "cases api anonymous" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/cases")"
check "notifications anonymous" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/notifications")"
# CSP must carry a nonce and must not allow inline scripts.
CSP=$(curl -sI "$BASE/login" | tr -d '\r' | grep -i '^content-security-policy:' || true)
echo "$CSP" | grep -q "'nonce-" && check "csp nonce" "present" "present" || check "csp nonce" "present" "missing"
echo "$CSP" | grep -q "script-src 'self' 'unsafe-inline'" && check "csp unsafe-inline" "absent" "present" || check "csp unsafe-inline" "absent" "absent"

echo "scheduler service: $(systemctl is-active shomaldoc 2>/dev/null || echo unknown)"
[ "$FAIL" -eq 0 ] && echo "post-deploy-check PASSED" || echo "post-deploy-check FAILED"
exit $FAIL
