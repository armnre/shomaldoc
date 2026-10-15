#!/usr/bin/env bash
# One command that produces a consistent, restorable set: database + uploaded files.
# Prints a SHA256SUMS file next to the artifacts so a restore can prove integrity.
set -euo pipefail
DIR=$(dirname "$0")
BACKUP_DIR=${BACKUP_DIR:-/var/backups/shomaldoc}
DB=$(bash "$DIR/backup-db.sh" | awk '{print $3}')
UP=$(bash "$DIR/backup-uploads.sh" | awk '{print $3}')
umask 077
( cd "$BACKUP_DIR" && sha256sum "$(basename "$DB")" "$(basename "$UP")" > "SHA256SUMS-$(basename "$DB" .sql.gz)" )
echo "backup set complete:"
echo "  database: $DB"
echo "  uploads:  $UP"
echo "  checksums: $BACKUP_DIR/SHA256SUMS-$(basename "$DB" .sql.gz)"
