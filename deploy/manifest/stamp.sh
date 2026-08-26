#!/usr/bin/env bash
# `stamp.sh <component> <value>` records that one component now sits at <value> in the image
# manifest, creating the file if this is the first stamp of a bake. Installers call it as their
# last step, so a live update that re-runs just one installer leaves a manifest that says exactly
# which parts moved (the image `version` stays put until every component matches the target).
#
# OYREN_IMAGE_MANIFEST overrides the manifest path (tests, dry runs).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ $# -eq 2 ] || { echo "usage: stamp.sh <component> <value>" >&2; exit 2; }
FILE="${OYREN_IMAGE_MANIFEST:-/etc/oyren/image-manifest.json}"
install -d -m 0755 "$(dirname "$FILE")"
node "$HERE/manifest.mjs" stamp "$FILE" "$1" "$2"
