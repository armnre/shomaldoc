#!/usr/bin/env bash
# Installs Node.js 22 LTS from the official nodejs.org tarball into an isolated prefix.
# Why not replace the system Node: the host has an incomplete Node 18 without npm, and Plesk
# may depend on the existing runtime. The app uses only /opt/shomaldoc/node/current/bin.
set -euo pipefail
PREFIX=/opt/shomaldoc/node
BASE=https://nodejs.org/dist/latest-v22.x
echo "before: node=$(command -v node || echo none) $(node -v 2>/dev/null || true) npm=$(command -v npm || echo none)"
SUMS=$(curl -fsSL "$BASE/SHASUMS256.txt")
FILE=$(echo "$SUMS" | awk '/linux-x64\.tar\.xz$/{print $2; exit}')
[ -n "$FILE" ] || { echo "cannot find linux-x64 tarball"; exit 1; }
VER=$(echo "$FILE" | sed -E 's/^node-(v[0-9.]+)-linux-x64\.tar\.xz$/\1/')
if [ -x "$PREFIX/$VER/bin/node" ]; then
  echo "already installed: $VER"
else
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  curl -fsSL -o "$TMP/$FILE" "$BASE/$FILE"
  echo "$SUMS" | grep " $FILE\$" | (cd "$TMP" && sed "s#  .*#  $FILE#" | sha256sum -c -)
  mkdir -p "$PREFIX/$VER"
  tar -xJf "$TMP/$FILE" -C "$PREFIX/$VER" --strip-components=1
fi
ln -sfn "$PREFIX/$VER" "$PREFIX/current"
"$PREFIX/current/bin/node" -v
"$PREFIX/current/bin/npm" -v
echo "use: $PREFIX/current/bin"
