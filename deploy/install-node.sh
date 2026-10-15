#!/usr/bin/env bash
# Installs Node.js 22 LTS into an isolated prefix (/opt/shomaldoc/node).
# Why not replace the system Node: the host has an incomplete Node 18 without npm and
# Plesk may depend on the existing runtime. The app uses only /opt/shomaldoc/node/current/bin.
#
# OFFLINE FIRST: the production server has no reliable route to nodejs.org. Download the
# tarball elsewhere and hand it over with its checksum:
#   bash install-node.sh --from node-v22.x.y-linux-x64.tar.xz --sha256 <hash>
# Network mode exists for hosts that do reach nodejs.org and must be asked for explicitly:
#   ALLOW_NETWORK=1 bash install-node.sh
set -euo pipefail
PREFIX=${PREFIX:-/opt/shomaldoc/node}
FROM=""; SHA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM=$2; shift 2;;
    --sha256) SHA=$2; shift 2;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
mkdir -p "$PREFIX"
echo "before: node=$(command -v node || echo none) $(node -v 2>/dev/null || true) npm=$(command -v npm || echo none)"

if [ -n "$FROM" ]; then
  [ -f "$FROM" ] || { echo "no such tarball: $FROM" >&2; exit 1; }
  if [ -n "$SHA" ]; then
    echo "$SHA  $FROM" | sha256sum -c - || { echo "checksum mismatch; refusing to install" >&2; exit 1; }
  else
    echo "NOTE: no --sha256 given; computing it for the record:"
    sha256sum "$FROM"
  fi
  FILE=$(basename "$FROM")
  VER=$(echo "$FILE" | sed -E 's/^node-(v[0-9.]+)-linux-x64\.tar\.xz$/\1/')
  [ "$VER" != "$FILE" ] || { echo "cannot derive the version from $FILE" >&2; exit 1; }
  if [ -x "$PREFIX/$VER/bin/node" ]; then
    echo "already installed: $VER"
  else
    mkdir -p "$PREFIX/$VER"
    tar -xJf "$FROM" -C "$PREFIX/$VER" --strip-components=1
  fi
elif [ "${ALLOW_NETWORK:-0}" = "1" ]; then
  BASE=https://nodejs.org/dist/latest-v22.x
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
else
  echo "offline host: pass --from <node tarball> [--sha256 <hash>], or set ALLOW_NETWORK=1" >&2
  exit 1
fi

ln -sfn "$PREFIX/$VER" "$PREFIX/current"
"$PREFIX/current/bin/node" -v
"$PREFIX/current/bin/npm" -v
echo "use: $PREFIX/current/bin"
