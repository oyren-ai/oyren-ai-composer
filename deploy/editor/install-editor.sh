#!/usr/bin/env bash
# Install openvscode-server onto a sandbox droplet and rebrand it as the Oyren Editor.
#
# Runs as root during the snapshot bake (called from deploy/bake-install.sh), so the editor is
# baked into the image and a launching droplet starts it with no download. Agents run directly on
# the droplet, so the editor sits on the same filesystem and PATH as the agent CLI and the
# toolchains — which is what makes language servers (Lean's infoview, tsserver, …) work and what
# makes the agent's edits show up live in the user's editor.
#
# Idempotent: re-running upgrades in place. Safe to call from a re-bake.
#
# Env:
#   OPENVSCODE_VERSION  pinned release (bump deliberately — see README)
#   EDITOR_USER         unix user that owns and runs the editor (default: oyren)
#   INSTALL_DIR         where the server lands (default: /opt/openvscode-server)
set -euo pipefail

OPENVSCODE_VERSION="${OPENVSCODE_VERSION:-1.109.5}"
EDITOR_USER="${EDITOR_USER:-oyren}"
INSTALL_DIR="${INSTALL_DIR:-/opt/openvscode-server}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARBALL="openvscode-server-v${OPENVSCODE_VERSION}-linux-x64"
URL="https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OPENVSCODE_VERSION}/${TARBALL}.tar.gz"

echo "==> openvscode-server v${OPENVSCODE_VERSION} -> ${INSTALL_DIR}"
rm -rf "$INSTALL_DIR" "/opt/${TARBALL}"
curl -fsSL "$URL" | tar -xz -C /opt
mv "/opt/${TARBALL}" "$INSTALL_DIR"

# product.json carries the branding. Merge rather than replace: it also holds the Open VSX gallery
# config and the commit/quality fields the server needs at runtime, and clobbering those bricks it.
# node is guaranteed here — bake-install.sh installs Node 24 before calling this.
echo "==> Rebranding product.json"
node - "$INSTALL_DIR/product.json" "$HERE/product.overrides.json" <<'NODE'
const fs = require('node:fs')
const [, , productPath, overridesPath] = process.argv
const product = JSON.parse(fs.readFileSync(productPath, 'utf8'))
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
for (const [key, value] of Object.entries(overrides)) {
  if (key.startsWith('_')) continue // documentation keys, not product fields
  product[key] = value
}
fs.writeFileSync(productPath, `${JSON.stringify(product, null, 2)}\n`)
console.log(`    nameLong=${product.nameLong} gallery=${product.extensionsGallery ? 'preserved' : 'ABSENT'}`)
NODE

# Machine-level settings live under the EDITOR_USER's home, at the path openvscode derives from
# product.json's serverDataFolderName — which is why that key is deliberately left alone.
EDITOR_HOME="$(getent passwd "$EDITOR_USER" | cut -d: -f6)"
if [ -z "$EDITOR_HOME" ]; then
  echo "ERROR: user '$EDITOR_USER' does not exist — create it before installing the editor" >&2
  exit 1
fi
SETTINGS_DIR="$EDITOR_HOME/.openvscode-server/data/Machine"
echo "==> Seeding machine settings -> $SETTINGS_DIR/settings.json"
mkdir -p "$SETTINGS_DIR"
install -m 0644 "$HERE/machine-settings.json" "$SETTINGS_DIR/settings.json"

chown -R "$EDITOR_USER:$EDITOR_USER" "$INSTALL_DIR" "$EDITOR_HOME/.openvscode-server"

echo "✅ Oyren Editor installed (openvscode-server v${OPENVSCODE_VERSION}, user=${EDITOR_USER})"
