#!/usr/bin/env bash
# Publish a built release to the private Spaces bucket the orchestrator presigns downloads from:
#
#   sandbox-releases/<family>/<version>/manifest.json
#   sandbox-releases/<family>/<version>/release.tar.gz
#   sandbox-releases/<family>/latest.json          (only with --latest, i.e. after promotion)
#
#   publish-release.sh --family base --image-id 242661992 --out DIR [--latest]
#
# Env: SPACES_BUCKET, SPACES_REGION (endpoint https://<region>.digitaloceanspaces.com),
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (the bucket's key pair). Uses the aws CLI, which the
# GitHub runner ships; objects stay private (the bucket default).
set -euo pipefail

FAMILY="base" IMAGE_ID="" OUT="" LATEST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --family) FAMILY="$2"; shift 2 ;;
    --image-id) IMAGE_ID="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --latest) LATEST=1; shift ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$OUT" ] || { echo "usage: publish-release.sh --family F --image-id ID --out DIR [--latest]" >&2; exit 2; }
: "${SPACES_BUCKET:?must be set (the private releases bucket)}"
: "${SPACES_REGION:?must be set (e.g. fra1)}"
command -v aws >/dev/null || { echo "ERROR: aws CLI is required to publish" >&2; exit 1; }

MANIFEST="$OUT/manifest.$FAMILY.json"
TARBALL="$OUT/release.tar.gz"
[ -f "$MANIFEST" ] && [ -f "$TARBALL" ] || { echo "ERROR: build-release.sh output missing in $OUT" >&2; exit 1; }
VERSION="$(jq -r '.version' "$MANIFEST")"
PREFIX="sandbox-releases/$FAMILY"
ENDPOINT="https://${SPACES_REGION}.digitaloceanspaces.com"

put() { # put <key> <file> <content-type>
  aws s3api put-object --endpoint-url "$ENDPOINT" --bucket "$SPACES_BUCKET" \
    --key "$1" --body "$2" --content-type "$3" >/dev/null
  echo "  uploaded s3://$SPACES_BUCKET/$1"
}

echo "▶ publishing $FAMILY $VERSION to $SPACES_BUCKET"
put "$PREFIX/$VERSION/manifest.json" "$MANIFEST" application/json
put "$PREFIX/$VERSION/release.tar.gz" "$TARBALL" application/gzip

if [ "$LATEST" = 1 ]; then
  LATEST_FILE="$(mktemp)"
  jq -n --arg v "$VERSION" --arg f "$FAMILY" --arg i "$IMAGE_ID" --arg p "$PREFIX" \
    --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{version:$v, family:$f, imageId:$i, manifestKey:($p+"/"+$v+"/manifest.json"), tarballKey:($p+"/"+$v+"/release.tar.gz"), publishedAt:$t}' \
    > "$LATEST_FILE"
  put "$PREFIX/latest.json" "$LATEST_FILE" application/json
  rm -f "$LATEST_FILE"
  echo "✅ $FAMILY latest.json now points at $VERSION (image $IMAGE_ID)"
else
  echo "✅ $FAMILY $VERSION published (latest.json untouched: not promoted)"
fi
