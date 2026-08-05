#!/usr/bin/env bash
# Install Oyren's OWN VS Code extensions into the baked editor. Called by install-editor.sh after the
# openvscode-server tarball is in place (that script wipes INSTALL_DIR, so order matters).
#
# They ship as unpacked folders in the server's BUILT-IN extensions dir rather than as .vsix
# installs. Three reasons: no `@vscode/vsce` and no npm fetch during a bake on a 1GB droplet; there
# is no registry to publish first-party code to (Open VSX is for vendors, and Microsoft's
# Marketplace is off-limits by its own terms); and built-ins survive a per-session
# `~/.openvscode-server` data dir being wiped, which user-installed extensions do not.
#
# Env:
#   EDITOR_USER          unix user that owns and runs the editor (default: oyren)
#   INSTALL_DIR          where the server lives (default: /opt/openvscode-server)
#   INSTALL_CHAT_PROBE   1 (default) installs the throwaway chat-view probe
set -euo pipefail

EDITOR_USER="${EDITOR_USER:-oyren}"
INSTALL_DIR="${INSTALL_DIR:-/opt/openvscode-server}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install_local_ext() {
  local src="$HERE/$1"
  [ -d "$src" ] || { echo "    WARNING: $1 missing, skipped" >&2; return 0; }
  rm -rf "${INSTALL_DIR:?}/extensions/$1"
  cp -R "$src" "$INSTALL_DIR/extensions/$1"
  chown -R "$EDITOR_USER:$EDITOR_USER" "$INSTALL_DIR/extensions/$1"
  echo "    $1"
}

# STEP 1 of docs/oyren-chat-participant.md: a throwaway participant that proves this build renders
# the Chat view at all. Default ON so a bake answers the question; set INSTALL_CHAT_PROBE=0 once the
# real participant ships and this folder is deleted.
if [ "${INSTALL_CHAT_PROBE:-1}" = "1" ]; then
  echo "==> Oyren chat probe (local, unpacked)"
  install_local_ext oyren-chat-probe
fi
