#!/usr/bin/env bash
# Builds the deployable tarball. Includes public/ binaries (logos, PWA icons)
# and excludes node_modules/.next/.git. Prints size + SHA256 for the handoff report.
set -euo pipefail
OUT=${1:-dist}
VERSION=$(node -p "require('./package.json').version")
NAME="shomaldoc-${VERSION}"
mkdir -p "$OUT"
tar --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude=./dist \
    --exclude=./test-results --exclude=./playwright-report --exclude=./storage \
    -czf "$OUT/$NAME.tar.gz" .
SIZE=$(du -h "$OUT/$NAME.tar.gz" | cut -f1)
SUM=$(sha256sum "$OUT/$NAME.tar.gz" | cut -d' ' -f1)
echo "package: $OUT/$NAME.tar.gz"
echo "size:    $SIZE"
echo "sha256:  $SUM"
# Prove the binaries are inside the archive (M0 acceptance).
tar -tzf "$OUT/$NAME.tar.gz" | grep -E '^\./public/(branding|icons)/' | sort
