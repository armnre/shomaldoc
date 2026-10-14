#!/usr/bin/env bash
# Read-only server audit. Changes nothing. Safe to run on the production host.
set -uo pipefail
echo "== OS";            grep -E 'PRETTY_NAME' /etc/os-release 2>/dev/null; uname -m
echo "== Node/npm";      for b in node npm; do printf '%s: ' "$b"; command -v "$b" >/dev/null && "$b" -v || echo "not found"; done
echo "== Node prefixes"; ls -d /opt/shomaldoc/node/* 2>/dev/null || echo "no /opt/shomaldoc/node yet"
echo "== Ports (listening)"; (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E ':(80|443|3080|5432|8443|8880)\b' || true
echo "== PostgreSQL";    (psql --version 2>/dev/null || echo "psql not found"); systemctl is-active postgresql 2>/dev/null || true
echo "== Databases (names only)"; sudo -u postgres psql -tAc "select datname from pg_database where not datistemplate" 2>/dev/null || echo "cannot query (run as root)"
echo "== ShomalDoc";     systemctl is-active shomaldoc 2>/dev/null || echo "service not installed"; ls -la /etc/shomaldoc 2>/dev/null || echo "no /etc/shomaldoc"
echo "== Docker";        command -v docker >/dev/null && docker -v || echo "docker not installed"
echo "== Disk";          df -h / | tail -1
