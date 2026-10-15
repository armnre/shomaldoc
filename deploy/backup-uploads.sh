#!/usr/bin/env bash
# Backs up the uploaded files (thesis PDFs, receipts, minutes) — not just the DB.
# A database-only backup restores broken links: files live under UPLOAD_DIR and are
# never stored inside PostgreSQL. Produces a tarball + SHA256, owner-only, 14 copies.
set -euo pipefail
ENV_FILE=${ENV_FILE:-/etc/shomaldoc/app.env}; BACKUP_DIR=${BACKUP_DIR:-/var/backups/shomaldoc}; KEEP=${KEEP:-14}
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
UP=${UPLOAD_DIR:-/opt/shomaldoc/shared/storage/uploads}
[ -d "$UP" ] || { echo "upload dir not found: $UP" >&2; exit 1; }
umask 077; mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$BACKUP_DIR/shomaldoc-uploads-$TS.tar.gz"
BASE=$(basename "$UP")
tar -czf "$FILE.partial" -C "$(dirname "$UP")" "$BASE"
gzip -t "$FILE.partial"
mv "$FILE.partial" "$FILE"; chmod 600 "$FILE"
sha256sum "$FILE" | cut -d' ' -f1 > "$FILE.sha256"; chmod 600 "$FILE.sha256"
COUNT=$(tar -tzf "$FILE" | grep -c '[^/]$' || true)
ls -1t "$BACKUP_DIR"/shomaldoc-uploads-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f --
ls -1t "$BACKUP_DIR"/shomaldoc-uploads-*.tar.gz.sha256 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f --
echo "uploads backup: $FILE (files: $COUNT)"
