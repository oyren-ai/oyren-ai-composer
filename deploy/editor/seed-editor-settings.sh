#!/usr/bin/env bash
# Seed the editor's settings for a fresh sandbox. Called by install-editor.sh once the EDITOR_USER
# exists; separate from it because that script installs a vendor server and this writes our config —
# different jobs, different failure modes.
#
# The settings FILES come from the extras tarball (EXTRAS_DIR, downloaded by install-editor.sh from
# the fork's rolling editor-extras release) — the same files oyren-editor-update re-seeds at boot.
#
# Two scopes, deliberately:
#   Machine — the full Oyren defaults (machine-settings.json): theme, terminal agent profiles,
#             chat mode availability. The right layer for per-server policy.
#   User    — ONLY the two startup keys, duplicated from Machine as insurance: the core
#             "Setup VS Code Web" walkthrough auto-opened on live sessions DESPITE the Machine-scope
#             startupEditor=none, so the same keys are pinned at User scope too. Users can still
#             edit their settings; a fresh sandbox merely starts from these.
set -euo pipefail

EDITOR_USER="${EDITOR_USER:-oyren}"
SETTINGS_DIR="${EXTRAS_DIR:?EXTRAS_DIR must point at the extracted editor-extras tarball}/settings"

EDITOR_HOME="$(getent passwd "$EDITOR_USER" | cut -d: -f6)"
if [ -z "$EDITOR_HOME" ]; then
  echo "ERROR: user '$EDITOR_USER' has no home directory" >&2
  exit 1
fi
DATA="$EDITOR_HOME/.openvscode-server/data"

echo "==> Seeding machine settings -> $DATA/Machine/settings.json"
mkdir -p "$DATA/Machine" "$DATA/User"
install -m 0644 "$SETTINGS_DIR/machine-settings.json" "$DATA/Machine/settings.json"

echo "==> Seeding user startup settings -> $DATA/User/settings.json"
touch "$DATA/User/.oyren-seeded" # oyren-editor-update respects this: the User file is seeded once, then owned by the user
install -m 0644 "$SETTINGS_DIR/user-settings.json" "$DATA/User/settings.json"

chown -R "$EDITOR_USER:$EDITOR_USER" "$EDITOR_HOME/.openvscode-server"
