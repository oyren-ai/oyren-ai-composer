#!/usr/bin/env bash
# Swap the installed openvscode-server for another release build. Called by oyren-editor-update
# when the extras manifest's server-version differs from the installed stamp — this is how a new
# fork build reaches sessions without a snapshot bake.
#
#   oyren-editor-server-swap <version> <extras-dir>
#
# <extras-dir> is the extracted extras tarball: it provides scripts/merge-product.js and
# settings/product.overrides.json, which must be re-applied because a release tarball ships the
# unbranded product.json. Everything is downloaded and verified in a temp dir first; any failure
# exits nonzero WITHOUT touching the installed server (the caller treats that as inert). The final
# rename runs under sudo because /opt itself is root-owned (the tree inside is ours).
#
# Env:
#   INSTALL_DIR               where the server lives (default: /opt/openvscode-server)
#   OPENVSCODE_DOWNLOAD_BASE  releases base URL; derived from the version unless overridden
set -euo pipefail

VERSION="${1:?usage: oyren-editor-server-swap <version> <extras-dir>}"
EXTRAS="${2:?usage: oyren-editor-server-swap <version> <extras-dir>}"
INSTALL_DIR="${INSTALL_DIR:-/opt/openvscode-server}"

case "$VERSION" in
  *-oyren.*) DEFAULT_BASE="https://github.com/oyren-ai/openvscode-server/releases/download" ;;
  *)         DEFAULT_BASE="https://github.com/gitpod-io/openvscode-server/releases/download" ;;
esac
BASE="${OPENVSCODE_DOWNLOAD_BASE:-$DEFAULT_BASE}"
TARBALL="openvscode-server-v${VERSION}-linux-x64"
URL="${BASE}/openvscode-server-v${VERSION}/${TARBALL}.tar.gz"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "    downloading ${URL}"
curl -fsSL --max-time 300 --retry 2 -o "$TMP/server.tar.gz" "$URL"
tar -xzf "$TMP/server.tar.gz" -C "$TMP"
[ -x "$TMP/$TARBALL/bin/openvscode-server" ] || { echo "    tarball missing bin/openvscode-server" >&2; exit 1; }

node "$EXTRAS/scripts/merge-product.js" "$TMP/$TARBALL/product.json" "$EXTRAS/settings/product.overrides.json"
printf '%s\n' "$VERSION" > "$TMP/$TARBALL/.oyren-version"

# The swap window is fine: at boot this runs from ExecStartPre (editor not started yet), and a
# manual run is followed by the caller's systemctl restart.
sudo rm -rf "${INSTALL_DIR}.new"
sudo mv "$TMP/$TARBALL" "${INSTALL_DIR}.new"
sudo chown -R "$(id -un):$(id -gn)" "${INSTALL_DIR}.new"
sudo rm -rf "$INSTALL_DIR"
sudo mv "${INSTALL_DIR}.new" "$INSTALL_DIR"
echo "    server swapped to ${VERSION}"
