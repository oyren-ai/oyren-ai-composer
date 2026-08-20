#!/usr/bin/env bash
# Install openvscode-server onto a sandbox droplet and rebrand it as the Oyren Editor.
#
# Runs as root during the snapshot bake (called from deploy/bake-install.sh), so the editor is
# baked into the image and a launching droplet starts it with no download. Agents run directly on
# the droplet, so the editor sits on the same filesystem and PATH as the agent CLI and the
# toolchains — which is what makes language servers (Lean's infoview, tsserver, …) work and what
# makes the agent's edits show up live in the user's editor.
#
# The editor CONTENT (first-party extensions, settings, product overrides) is not in this repo:
# it ships as the rolling "editor-extras" release published from the fork's oyren/ dir, the same
# tarball every session refreshes from at boot (oyren-editor-update). The bake downloads it here
# for the offline fallback — one source of truth, and a fetch failure fails the bake LOUDLY
# because baking stale editor content silently is worse.
#
# Idempotent: re-running upgrades in place. Safe to call from a re-bake.
#
# Env:
#   OPENVSCODE_VERSION       pinned release (bump deliberately — see README)
#   OPENVSCODE_DOWNLOAD_BASE releases base URL; derived from the version unless overridden
#   OYREN_EDITOR_EXTRAS_URL  override the extras tarball URL
#   EDITOR_USER              unix user that owns and runs the editor (default: oyren)
#   INSTALL_DIR              where the server lands (default: /opt/openvscode-server)
#   INSTALL_CLAUDE_EXTENSION 1 (default) installs anthropic.claude-code from Open VSX
#   INSTALL_CODEX_EXTENSION  1 (default) installs openai.chatgpt (Codex) from Open VSX
#   INSTALL_QWEN_EXTENSION   1 (default) installs qwenlm.qwen-code-vscode-ide-companion from Open VSX
set -euo pipefail

OPENVSCODE_VERSION="${OPENVSCODE_VERSION:-1.109.5-oyren.3}"
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

EXTRAS_DEFAULT_URL="https://github.com/oyren-ai/openvscode-server/releases/download/editor-extras/oyren-editor-extras.tar.gz"
EXTRAS_URL="${OYREN_EDITOR_EXTRAS_URL:-$EXTRAS_DEFAULT_URL}"

# The two tarballs this script downloads, named for the bake's download cache. `--print-assets`
# prints "<cache-name> <url>" for each and exits BEFORE any side effect (note it comes above the
# mktemp below on purpose) — that is how deploy/bake/prefetch.sh learns to pull them during the
# bake's idle apt wait without a second copy of the pin to drift from. The extras tarball is a
# ROLLING release, so its cache name carries no version; the server tarball's already does.
SERVER_ASSET="${TARBALL}.tar.gz"
EXTRAS_ASSET="oyren-editor-extras.tar.gz"
if [ "${1:-}" = "--print-assets" ]; then
  printf '%s %s\n' "$SERVER_ASSET" "$URL" "$EXTRAS_ASSET" "$EXTRAS_URL"
  exit 0
fi

# Use whatever the prefetcher already pulled down; download here when it did not (a standalone run,
# or a failed prefetch). A missing extras tarball still fails the bake LOUDLY, as the header says.
. "$HERE/../bake/prefetch.sh"

EXTRAS_DIR="$(mktemp -d)"
trap 'rm -rf "$EXTRAS_DIR"' EXIT

echo "==> editor extras -> ${EXTRAS_DIR}"
cached_untar "$EXTRAS_ASSET" "$EXTRAS_URL" "$EXTRAS_DIR"
[ -d "$EXTRAS_DIR/extensions" ] && [ -f "$EXTRAS_DIR/settings/product.overrides.json" ] \
  || { echo "ERROR: extras tarball malformed — publish with oyren/scripts/pack-editor-extras.sh" >&2; exit 1; }

echo "==> openvscode-server v${OPENVSCODE_VERSION} -> ${INSTALL_DIR}"
rm -rf "$INSTALL_DIR" "/opt/${TARBALL}"
cached_untar "$SERVER_ASSET" "$URL" /opt
mv "/opt/${TARBALL}" "$INSTALL_DIR"

# product.json carries the branding. The merge script + overrides come from the extras tarball so
# a boot-time server swap re-applies the exact same branding this bake does.
echo "==> Rebranding product.json"
node "$EXTRAS_DIR/scripts/merge-product.js" "$INSTALL_DIR/product.json" "$EXTRAS_DIR/settings/product.overrides.json"

# The stamp oyren-editor-update compares against the extras manifest's server-version: a mismatch
# at boot means "swap the whole server", which is how fork builds ship without a re-bake.
printf '%s\n' "$OPENVSCODE_VERSION" > "$INSTALL_DIR/.oyren-version"

# The VM is a bare Ubuntu image: the `oyren` user only ever existed inside the sandbox container,
# so create it here. Agents run as this user on the droplet, and it owns the editor and its data.
# Settings live under its home at the path openvscode derives from product.json's
# serverDataFolderName — which is why that key is deliberately left alone.
if ! getent passwd "$EDITOR_USER" >/dev/null; then
  echo "==> creating user $EDITOR_USER"
  useradd --create-home --shell /bin/bash "$EDITOR_USER"
fi
EDITOR_USER="$EDITOR_USER" EXTRAS_DIR="$EXTRAS_DIR" "$HERE/seed-editor-settings.sh"
chown -R "$EDITOR_USER:$EDITOR_USER" "$INSTALL_DIR"

# Marketplace CLI-agent extensions (Claude Code, Codex, Qwen), from Open VSX — split into their own
# script because installing vendor extensions is a different job from installing the VENDOR server.
# The INSTALL_*_EXTENSION toggles above pass through via the environment.
EDITOR_USER="$EDITOR_USER" INSTALL_DIR="$INSTALL_DIR" "$HERE/install-marketplace-extensions.sh"

# Oyren's own first-party extensions — kept in their own script because this one installs a VENDOR
# server and that is a different job with a different failure mode.
EDITOR_USER="$EDITOR_USER" INSTALL_DIR="$INSTALL_DIR" EXTRAS_DIR="$EXTRAS_DIR" "$HERE/install-oyren-extensions.sh"

echo "✅ Oyren Editor installed (openvscode-server v${OPENVSCODE_VERSION}, user=${EDITOR_USER})"
