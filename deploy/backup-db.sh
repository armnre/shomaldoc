#!/usr/bin/env bash
# Compressed logical backup with integrity check and 14-copy retention. Owner-only permissions.
set -euo pipefail
ENV_FILE=${ENV_FILE:-/etc/shomaldoc/app.env}; BACKUP_DIR=${BACKUP_DIR:-/var/backups/shomaldoc}; KEEP=${KEEP:-14}
set -a; . "$ENV_FILE"; set +a
umask 077; mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
FILE="$BACKUP_DIR/shomaldoc-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$FILE.partial"
gzip -t "$FILE.partial"
mv "$FILE.partial" "$FILE"; chmod 600 "$FILE"
ls -1t "$BACKUP_DIR"/shomaldoc-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f --
echo "backup ok: $FILE"
