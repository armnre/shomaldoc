#!/usr/bin/env bash
# Read-only audit of the production host, the reverse proxy and the exposure of the
# app. Changes nothing. Exits non-zero when a hardening rule is violated.
set -uo pipefail
BASE=${BASE_URL:-http://127.0.0.1:3080}
PUBLIC=${PUBLIC_URL:-https://shomaldoc.shomal.ac.ir}
FAIL=0
ok()   { echo "ok   $1"; }
bad()  { echo "FAIL $1"; FAIL=1; }
warn() { echo "warn $1"; }

echo "== runtime"
command -v node >/dev/null && echo "node: $(node -v) ($(command -v node))" || warn "node not on PATH"
[ -x /opt/shomaldoc/node/current/bin/node ] && ok "/opt/shomaldoc/node/current/bin/node $(/opt/shomaldoc/node/current/bin/node -v)" || bad "isolated Node 22 prefix missing"

echo "== app binding (must be loopback only; the proxy terminates TLS)"
BIND=$(ss -ltnp 2>/dev/null | grep -E ':3080\b' || true)
[ -n "$BIND" ] || bad "nothing listening on 3080"
if echo "$BIND" | grep -qE '127\.0\.0\.1:3080|\*:3080.*127\.0\.0\.1'; then ok "3080 bound to loopback"; fi
if echo "$BIND" | grep -qE '0\.0\.0\.0:3080|\[::\]:3080'; then bad "3080 is bound publicly (should be 127.0.0.1 behind the proxy)"; fi

echo "== firewall / brute-force protection"
command -v fail2ban-client >/dev/null && ok "fail2ban present" || warn "fail2ban client not found"
command -v csf >/dev/null && ok "CSF present" || warn "CSF not found"

echo "== app-level headers (through the proxy, as a client sees them)"
H=$(curl -sI "$PUBLIC/login" 2>/dev/null | tr -d '\r' || true)
echo "$H" | grep -qi '^strict-transport-security:' && ok "HSTS present" || bad "HSTS missing from $PUBLIC"
echo "$H" | grep -qi '^content-security-policy:' && ok "CSP present" || bad "CSP missing"
echo "$H" | grep -qi '^x-robots-tag:.*noindex' && ok "X-Robots-Tag noindex" || warn "X-Robots-Tag not seen"
echo "$H" | grep -qi '^x-frame-options: *DENY' && ok "X-Frame-Options DENY" || warn "X-Frame-Options not DENY"

echo "== direct exposure (the app must not be reachable as :3080 from the internet)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "${PUBLIC%:*}//${PUBLIC#*//}" 2>/dev/null || echo 000)
[ "$CODE" != "000" ] && ok "public URL answers ($CODE)" || bad "public URL does not answer"
IP=$(getent hosts "$(echo "$PUBLIC" | awk -F/ '{print $3}')" 2>/dev/null | awk '{print $1}' | head -1)
if [ -n "$IP" ]; then
  DIR=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "http://$IP:3080/login" || echo 000)
  [ "$DIR" = "000" ] && ok "3080 is not reachable directly on $IP" || bad "3080 answers directly on $IP ($DIR) — expose it to the proxy only"
fi

echo "== local health + smoke"
HEALTH=$(curl -fsS "$BASE/api/health" 2>/dev/null || echo '{}')
echo "$HEALTH" | grep -q '"db":"up"' && ok "health db=up" || bad "health endpoint not reporting db=up"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/login")" = "200" ] && ok "login page 200" || bad "login page not 200"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/cases")" = "401" ] && ok "api/cases rejects anonymous (401)" || bad "api/cases does not return 401 anonymously"

echo "== housekeeping"
systemctl is-active shomaldoc >/dev/null 2>&1 && ok "shomaldoc.service active" || warn "systemctl reports the service as inactive"
ls -1t /var/backups/shomaldoc/shomaldoc-*.sql.gz >/dev/null 2>&1 && ok "database backups present" || bad "no database backups found"
ls -1t /var/backups/shomaldoc/shomaldoc-uploads-*.tar.gz >/dev/null 2>&1 && ok "uploads backups present" || bad "no uploads backups found"
LOGROTATE=/etc/logrotate.d/shomaldoc
[ -f "$LOGROTATE" ] && ok "logrotate rule installed" || warn "no logrotate rule for shomaldoc"
df -h / | tail -1

[ "$FAIL" -eq 0 ] && echo "verify-host PASSED" || echo "verify-host FAILED"
exit $FAIL
