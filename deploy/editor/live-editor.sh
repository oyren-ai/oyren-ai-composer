#!/usr/bin/env bash
# Bring the editor on a LIVE droplet up to date. The editor has its own channel: the rolling
# editor-extras release on the public fork, which oyren-editor-update overlays at every editor
# start and escalates to a whole-server swap when the extras' server-version moves. A manifest
# diff on `editor` therefore means "run that updater now", never a second install path —
# install-editor.sh wipes /opt/openvscode-server and re-seeds the user's settings, both of which
# are wrong on a machine someone is working in.
#
# Runs as root from the release tree, but hands the work to the editor's own user: the swap
# helper chowns the new tree to whoever invokes it, and a root-owned server breaks the editor unit.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EDITOR_USER="${EDITOR_USER:-oyren}"
INSTALL_DIR="${INSTALL_DIR:-/opt/openvscode-server}"
USER_HOME="$(getent passwd "$EDITOR_USER" | cut -d: -f6)"

echo "==> editor: refreshing extras (and the server, if the extras manifest names a newer build)"
runuser -u "$EDITOR_USER" -- env HOME="$USER_HOME" INSTALL_DIR="$INSTALL_DIR" \
  /usr/local/bin/oyren-editor-update --boot

VERSION="$(tr -d '[:space:]' < "$INSTALL_DIR/.oyren-version" 2>/dev/null || echo unknown)"
"$HERE/../manifest/stamp.sh" editor "$VERSION"
echo "✅ editor at openvscode-server v${VERSION} (restart oyren-editor to pick up a swapped server)"
