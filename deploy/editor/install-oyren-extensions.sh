#!/usr/bin/env bash
# Install Oyren's OWN VS Code extensions into the baked editor. Called by install-editor.sh after the
# openvscode-server tarball is in place (that script wipes INSTALL_DIR, so order matters).
#
# The extension SOURCES come from the extras tarball (EXTRAS_DIR, downloaded by install-editor.sh
# from the fork's rolling editor-extras release, published from the fork's oyren/extensions/) —
# the same tarball oyren-editor-update overlays at every editor start, so bake and boot cannot
# drift apart. Only the dev-only chat probe still lives in this repo.
#
# They ship as unpacked folders in the server's BUILT-IN extensions dir rather than as .vsix
# installs: there is no registry to publish first-party code to (Open VSX is for vendors, and
# Microsoft's Marketplace is off-limits by its own terms), and built-ins survive a per-session
# `~/.openvscode-server` data dir being wiped, which user-installed extensions do not.
#
# Env:
#   EDITOR_USER          unix user that owns and runs the editor (default: oyren)
#   INSTALL_DIR          where the server lives (default: /opt/openvscode-server)
#   EXTRAS_DIR           extracted editor-extras tarball (required unless only the probe installs)
#   INSTALL_CHAT_PROBE   1 installs the throwaway chat-view probe (default 0)
#   INSTALL_OYREN_AGENT  1 (default) installs the Oyren agent chat participant
#   INSTALL_OYREN_PREVIEW 1 (default) installs the localhost-preview mini browser command
set -euo pipefail

EDITOR_USER="${EDITOR_USER:-oyren}"
INSTALL_DIR="${INSTALL_DIR:-/opt/openvscode-server}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install_ext_from() {
  local src="$1/$2"
  [ -d "$src" ] || { echo "    WARNING: $2 missing at $1, skipped" >&2; return 0; }
  rm -rf "${INSTALL_DIR:?}/extensions/$2"
  cp -R "$src" "$INSTALL_DIR/extensions/$2"
  chown -R "$EDITOR_USER:$EDITOR_USER" "$INSTALL_DIR/extensions/$2"
  echo "    $2"
}

# The STEP-1 probe, kept for manual debugging only — the one extension still sourced from THIS
# repo. Default OFF: both it and oyren-agent-extension declare an isDefault participant, and two
# defaults make the workbench's pick between them an implementation detail rather than a decision.
if [ "${INSTALL_CHAT_PROBE:-0}" = "1" ]; then
  echo "==> Oyren chat probe (local, unpacked)"
  install_ext_from "$HERE" oyren-chat-probe
fi

# The real integration: the sandbox agent as the Chat view's default participant plus one chat
# session type per CLI agent (docs/oyren-chat-participant.md).
if [ "${INSTALL_OYREN_AGENT:-1}" = "1" ]; then
  echo "==> Oyren agent extension (extras, unpacked)"
  install_ext_from "${EXTRAS_DIR:?EXTRAS_DIR must point at the extracted editor-extras tarball}/extensions" oyren-agent-extension
fi

# The middle pane's onboarding: the "Welcome to Oyren" walkthrough, opened once per sandbox by the
# extension itself (globalState latch). Set INSTALL_OYREN_WELCOME=0 for a bare editor.
if [ "${INSTALL_OYREN_WELCOME:-1}" = "1" ]; then
  echo "==> Oyren welcome walkthrough (extras, unpacked)"
  install_ext_from "${EXTRAS_DIR:?EXTRAS_DIR must point at the extracted editor-extras tarball}/extensions" oyren-welcome-extension
fi

# Mini localhost browser: a command (+ status bar item) that opens the built-in Simple Browser
# pointed at a local dev-server port, no public route required. Sourced from this repo, like the
# probe, since it doesn't need anything from the extras tarball.
if [ "${INSTALL_OYREN_PREVIEW:-1}" = "1" ]; then
  echo "==> Oyren preview (local, unpacked)"
  install_ext_from "$HERE" oyren-preview
fi
