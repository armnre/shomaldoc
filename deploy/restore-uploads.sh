#!/usr/bin/env bash
# Restores an uploads backup. Verifies the checksum, refuses unsafe archives
# (absolute paths / parent traversal), extracts to a temp dir first, then swaps.
# Usage: UPLOAD_DIR=/path TARGET_DIR=/path bash restore-uploads.sh <backup.tar.gz>
set -euo pipefail
FILE=${1:?usage: restore-uploads.sh <shomaldoc-uploads-*.tar.gz>}
ENV_FILE=${ENV_FILE:-/etc/shomaldoc/app.env}
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
TARGET=${TARGET_DIR:-${UPLOAD_DIR:-/opt/shomaldoc/shared/storage/uploads}}
[ -f "$FILE" ] || { echo "no such backup: $FILE" >&2; exit 1; }
[ -f "$FILE.sha256" ] && { echo "verifying checksum"; sha256sum -c "$FILE.sha256"; }
gzip -t "$FILE"
echo "checking archive paths"
if tar -tzf "$FILE" | grep -Eq '^/|(^|/)\.\./'; then echo "unsafe archive paths; refusing" >&2; exit 1; fi
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
tar -xzf "$FILE" -C "$WORK" --no-same-owner --no-same-permissions
SRC=$(find "$WORK" -maxdepth 1 -mindepth 1 -type d | head -1)
[ -n "$SRC" ] || { echo "archive contains no directory" >&2; exit 1; }
FILES=$(find "$SRC" -type f | wc -l)
if [ -d "$TARGET" ]; then
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  echo "keeping the previous contents as $TARGET.pre-restore-$STAMP"
  mv "$TARGET" "$TARGET.pre-restore-$STAMP"
fi
mkdir -p "$(dirname "$TARGET")"
mv "$SRC" "$TARGET"
echo "restored $FILES files into $TARGET"
