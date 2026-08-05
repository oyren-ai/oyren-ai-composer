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
#   INSTALL_OYREN_AGENT  1 (default) installs the Oyren agent chat participant
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

# The STEP-1 probe, kept for manual debugging only. Default OFF now that oyren-agent-extension
# ships: both declare an isDefault participant, and two defaults make the workbench's pick between
# them an implementation detail rather than a decision.
if [ "${INSTALL_CHAT_PROBE:-0}" = "1" ]; then
  echo "==> Oyren chat probe (local, unpacked)"
  install_local_ext oyren-chat-probe
fi

# The real integration the probe existed to de-risk: the sandbox agent as the Chat view's default
# participant, for every provider (docs/oyren-chat-participant.md).
if [ "${INSTALL_OYREN_AGENT:-1}" = "1" ]; then
  echo "==> Oyren agent extension (local, unpacked)"
  install_local_ext oyren-agent-extension
fi
