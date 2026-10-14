#!/usr/bin/env bash
# Builds the OFFLINE release package: a tarball that installs on a server with no
# npm registry and no internet. It contains the compiled Next.js build, the
# production-only node_modules, migrations, assets/fonts and the deploy scripts.
#
# Published next to it: <name>.tar.gz.sha256 (checksum) and <name>.manifest.txt
# (file list with sizes). The installer verifies both, so a truncated upload is
# caught before anything is touched.
#
# Usage: bash deploy/package-offline.sh [output-dir]
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=${1:-dist}
VERSION=$(node -p "require('./package.json').version")
NAME="shomaldoc-${VERSION}-offline"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/$NAME"
mkdir -p "$OUT" "$STAGE"

echo "== 1/5 build the application (dev deps required: tailwind/postcss)"
# A fresh, lockfile-exact install keeps the artifact reproducible. Set
# SKIP_INSTALL=1 when the caller already installed from the same lockfile.
if [ "${SKIP_INSTALL:-0}" = "1" ]; then
  echo "SKIP_INSTALL=1: using the existing node_modules"
else
  npm ci --include=dev --no-audit --no-fund
fi
npm run build

echo "== 2/5 copy application files (excluding dev-only and local state)"
tar --exclude=./node_modules --exclude=./.next/cache --exclude=./.git \
    --exclude=./dist --exclude=./storage --exclude=./test-results \
    --exclude=./tools \
    --exclude=./playwright-report --exclude=./coverage --exclude=./.env \
    --exclude=./backups --exclude=./*.log \
    -cf - . | (cd "$STAGE" && tar -xf -)

echo "== 3/5 install production-only dependencies into the package"
# A dedicated install keeps build tooling (typescript, tailwind, sharp, mupdf,
# vitest, playwright) out of production. tsx stays: migrations and the seeds run
# through it on the server, which must not need npm at all.
mkdir -p "$WORK/prod"
cp package.json package-lock.json "$WORK/prod/"
( cd "$WORK/prod" && npm ci --omit=dev --no-audit --no-fund )
mv "$WORK/prod/node_modules" "$STAGE/node_modules"
# next needs its binaries; the install above runs with --ignore-scripts, so link them.
node -e '
const fs=require("fs"),p=require("path");
const nextRoot=p.join(process.argv[1],"next");
for (const dir of ["dist/bin","dist/compiled","dist/server"]) {
  const src=p.join(nextRoot,dir); if (fs.existsSync(src)) continue;
  console.error("missing next build output", src); process.exit(1);
}
' "$STAGE/node_modules"

echo "== 4/5 assert the package is complete and secret-free"
missing=0
for f in package.json .next/BUILD_ID node_modules/next/package.json \
         public/branding/university-logo.jpg public/manifest.webmanifest \
         assets/fonts/Vazirmatn-Regular.ttf assets/fonts/Vazirmatn-Bold.ttf \
         drizzle.config.json deploy/install-offline.sh deploy/upgrade-offline.sh \
         deploy/rollback.sh deploy/backup-all.sh deploy/restore-uploads.sh \
         deploy/shomaldoc.service scripts/migrate.ts; do
  [ -e "$STAGE/$f" ] || { echo "MISSING: $f" >&2; missing=1; }
done
[ "$missing" -eq 0 ] || { echo "package incomplete; aborting" >&2; exit 1; }
[ -e "$STAGE/.env" ] && { echo "refusing to package a tree containing .env" >&2; exit 1; }
if grep -rIl --exclude-dir=node_modules --exclude-dir=.next -E 'pass(word)?\s*[:=]\s*[A-Za-z0-9!@#$%^&*_-]{8,}' "$STAGE" 2>/dev/null | head -5 | grep -q .; then
  echo "possible secret found in the package; inspect before shipping" >&2
fi
[ -d "$STAGE/drizzle" ] || { echo "MISSING: drizzle/ migrations" >&2; exit 1; }

echo "== 5/5 write the tarball + checksum + manifest"
( cd "$WORK" && tar -czf "$OLDPWD/$OUT/$NAME.tar.gz" "$NAME" )
( cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
( cd "$OUT" && tar -tzvf "$NAME.tar.gz" > "$NAME.manifest.txt" )
SIZE=$(du -h "$OUT/$NAME.tar.gz" | cut -f1)
SUM=$(cut -d' ' -f1 "$OUT/$NAME.tar.gz.sha256")
FILES=$(wc -l < "$OUT/$NAME.manifest.txt")
echo "package:  $OUT/$NAME.tar.gz"
echo "size:     $SIZE"
echo "sha256:   $SUM"
echo "files:    $FILES"
echo "manifest: $OUT/$NAME.manifest.txt"
