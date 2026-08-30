#!/usr/bin/env bash
# Build the release a bake publishes: the trees a live droplet needs to update itself (deploy/ and
# sandbox-runtime/, as a git archive) plus the manifest that describes the bake. Runs on the bake
# RUNNER from a clean checkout, so the tree hashes it records equal the ones the droplet computes
# from the same files (deploy/lib/tree-hash.sh, same relative paths from the tree root).
#
#   build-release.sh --family base|lean --version 2026-08-25-1838 --composer-sha 342436e --out DIR
#
# Writes DIR/release.tar.gz (shared by both families) and DIR/manifest.<family>.json.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$ROOT/deploy/lib/tree-hash.sh"

FAMILY="base" VERSION="" COMPOSER_SHA="" OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --family) FAMILY="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --composer-sha) COMPOSER_SHA="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$VERSION" ] && [ -n "$OUT" ] || { echo "usage: build-release.sh --family F --version V [--composer-sha S] --out DIR" >&2; exit 2; }
[ -n "$COMPOSER_SHA" ] || COMPOSER_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"

cd "$ROOT"
mkdir -p "$OUT"
TARBALL="$OUT/release.tar.gz"
if [ ! -f "$TARBALL" ]; then
  # Tracked files only, under a `composer/` prefix the updater strips. Untracked files never ship,
  # which is also why the hashes below are computed from the same tracked set.
  git archive --format=tar.gz --prefix=composer/ -o "$TARBALL" HEAD deploy sandbox-runtime
fi

LEAN="none"
[ "$FAMILY" = "lean" ] && LEAN="$(tr -d '[:space:]' < deploy/lean/template/lean-toolchain)"

node deploy/manifest/manifestCli.mjs build \
  --version "$VERSION" --family "$FAMILY" --composer-sha "$COMPOSER_SHA" \
  --versions-file deploy/versions.env \
  --hash "runtime=$(tree_hash sandbox-runtime deploy/sandbox-host deploy/units)" \
  --hash "host=$(tree_hash deploy/sandbox-host/install-host.sh deploy/sandbox-host/install-workspace-dir.sh deploy/versions.env)" \
  --hash "browser=$(tree_hash deploy/browser)" \
  --lean "$LEAN" --artifact "$TARBALL" > "$OUT/manifest.$FAMILY.json"

echo "✅ release built: $OUT/manifest.$FAMILY.json ($FAMILY $VERSION), $(du -h "$TARBALL" | cut -f1) tarball"
