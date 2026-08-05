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
#   OPENVSCODE_VERSION       pinned release (bump deliberately — see README)
#   OPENVSCODE_DOWNLOAD_BASE releases base URL; derived from the version unless overridden
#   EDITOR_USER              unix user that owns and runs the editor (default: oyren)
#   INSTALL_DIR              where the server lands (default: /opt/openvscode-server)
set -euo pipefail

OPENVSCODE_VERSION="${OPENVSCODE_VERSION:-1.109.5-oyren.2}"
EDITOR_USER="${EDITOR_USER:-oyren}"
INSTALL_DIR="${INSTALL_DIR:-/opt/openvscode-server}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# An "-oyren." version comes from our fork's releases, anything else from gitpod's — the fork carries
# the chat patches (a stock build's Chat view intercepts every turn with a Copilot setup agent that
# is INLINED into the workbench bundle at build time; no runtime product.json edit can reach it,
# which is why those patches exist). One env var overrides for mirrors/air-gapped installs.
case "$OPENVSCODE_VERSION" in
  *-oyren.*) DEFAULT_BASE="https://github.com/oyren-ai/openvscode-server/releases/download" ;;
  *)         DEFAULT_BASE="https://github.com/gitpod-io/openvscode-server/releases/download" ;;
esac
OPENVSCODE_DOWNLOAD_BASE="${OPENVSCODE_DOWNLOAD_BASE:-$DEFAULT_BASE}"

TARBALL="openvscode-server-v${OPENVSCODE_VERSION}-linux-x64"
URL="${OPENVSCODE_DOWNLOAD_BASE}/openvscode-server-v${OPENVSCODE_VERSION}/${TARBALL}.tar.gz"

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
const removed = []
for (const [key, value] of Object.entries(overrides)) {
  if (key.startsWith('_')) continue // documentation keys, not product fields
  // null means DELETE, not "set to null". Some workbench checks are `key in product` or truthiness
  // of a nested field, so leaving a null behind is not the same as the key being absent — and
  // absent is what we need for defaultChatAgent.
  if (value === null) {
    if (key in product) removed.push(key)
    delete product[key]
    continue
  }
  product[key] = value
}
fs.writeFileSync(productPath, `${JSON.stringify(product, null, 2)}\n`)
console.log(`    nameLong=${product.nameLong} gallery=${product.extensionsGallery ? 'preserved' : 'ABSENT'}`)
console.log(`    removed=${removed.length ? removed.join(',') : '(none)'}`)
NODE

# The VM is a bare Ubuntu image: the `oyren` user only ever existed inside the sandbox container,
# so create it here. Agents run as this user on the droplet, and it owns the editor and its data.
# Settings live under its home at the path openvscode derives from product.json's
# serverDataFolderName — which is why that key is deliberately left alone.
if ! getent passwd "$EDITOR_USER" >/dev/null; then
  echo "==> creating user $EDITOR_USER"
  useradd --create-home --shell /bin/bash "$EDITOR_USER"
fi
EDITOR_USER="$EDITOR_USER" "$HERE/seed-editor-settings.sh"
chown -R "$EDITOR_USER:$EDITOR_USER" "$INSTALL_DIR"

# Anthropic's VS Code extension, from Open VSX — NEVER Microsoft's Marketplace (its terms forbid
# non-Microsoft products; same reason extensionsGallery is left alone). It works here because it
# declares extensionKind:["workspace"] + ships linux-x64, i.e. runs in the SERVER-side extension
# host beside the `claude` binary and the session's credentials. Non-fatal on purpose: a registry
# hiccup must not sink a 15-minute bake.
if [ "${INSTALL_CLAUDE_EXTENSION:-1}" = "1" ]; then
  echo "==> Claude Code extension (Open VSX)"
  install_ext() { su - "$EDITOR_USER" -c "'$INSTALL_DIR/bin/openvscode-server' --install-extension '$1'"; }
  # Open VSX publishes the namespace as "Anthropic"; VS Code ids are conventionally lowercased.
  # Try the canonical id first, then the namespace-cased form, before giving up.
  if install_ext anthropic.claude-code || install_ext Anthropic.claude-code; then
    echo "    installed"
  else
    echo "    WARNING: claude-code extension unavailable — editor and chat pane are unaffected" >&2
  fi
fi

# Oyren's own first-party extensions — kept in their own script because this one installs a VENDOR
# server and that is a different job with a different failure mode.
EDITOR_USER="$EDITOR_USER" INSTALL_DIR="$INSTALL_DIR" "$HERE/install-oyren-extensions.sh"

echo "✅ Oyren Editor installed (openvscode-server v${OPENVSCODE_VERSION}, user=${EDITOR_USER})"
