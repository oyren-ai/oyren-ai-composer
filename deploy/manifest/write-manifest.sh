#!/usr/bin/env bash
# Write the image manifest at the end of a bake. Runs ON the droplet as root, from the composer
# tree at /srv/composer/app (or wherever --root points), after every installer has finished.
#
#   write-manifest.sh --version 2026-08-25-1838 --family base --composer-sha 342436e [--out FILE] [--root DIR]
#
# The hashed components are computed here with deploy/lib/tree-hash.sh, from the SAME relative
# paths the bake runner hashes in build-release.sh, so a droplet and the release it came from agree
# on whether the runtime changed. Everything pinned comes from deploy/versions.env.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib/tree-hash.sh"

VERSION="" FAMILY="base" COMPOSER_SHA="unknown" OUT="${OYREN_IMAGE_MANIFEST:-/etc/oyren/image-manifest.json}"
ROOT="$(cd "$HERE/../.." && pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --family) FAMILY="$2"; shift 2 ;;
    --composer-sha) COMPOSER_SHA="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --root) ROOT="$2"; shift 2 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$VERSION" ] || { echo "ERROR: --version is required (the bake's UTC stamp, e.g. 2026-08-25-1838)" >&2; exit 2; }

cd "$ROOT"
RUNTIME_HASH="$(tree_hash sandbox-runtime deploy/sandbox-host deploy/units)"
HOST_HASH="$(tree_hash deploy/sandbox-host/install-host.sh deploy/sandbox-host/install-workspace-dir.sh deploy/versions.env)"
BROWSER_HASH="$(tree_hash deploy/browser)"
LEAN="none"
[ "$FAMILY" = "lean" ] && LEAN="$(tr -d '[:space:]' < deploy/lean/template/lean-toolchain)"

install -d -m 0755 "$(dirname "$OUT")"
node "$HERE/manifestCli.mjs" build \
  --version "$VERSION" --family "$FAMILY" --composer-sha "$COMPOSER_SHA" \
  --versions-file deploy/versions.env \
  --hash "runtime=$RUNTIME_HASH" --hash "host=$HOST_HASH" --hash "browser=$BROWSER_HASH" \
  --lean "$LEAN" > "$OUT.tmp"
chmod 0644 "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "✅ image manifest written to $OUT ($FAMILY $VERSION, runtime $RUNTIME_HASH)"
