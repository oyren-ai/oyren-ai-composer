#!/usr/bin/env bash
# RETIRED — the base snapshot carries the Zed stack.
#
# Streamed Zed used to be a derived image because a session's editor was fixed at launch. It is not
# any more: a session switches between the browser editor and streamed Zed while it runs
# (sandbox-runtime/src/editorSurface.js), so both must exist in whatever image it booted from, and
# deploy/bake-install.sh installs the stack as part of the BASE bake.
#
# This shim stays only so the `Bake snapshots` workflow keeps working while it still offers a
# derive_zed step: it echoes the base id as the zed id — they are the same image now — in the
# format the workflow greps, and exits. Delete both once that workflow drops the step.
#
# DROPLET_SNAPSHOT_ID_ZED can now be unset in the orchestrator (it falls back to the base id) or
# pointed at the base id, which is the same image. The derive that used to live here is in git
# history: `git log --follow -- deploy/bake/derive-zed-snapshot.sh`.
set -euo pipefail

BASE_SNAPSHOT_ID="${BASE_SNAPSHOT_ID:-}"
[ -n "$BASE_SNAPSHOT_ID" ] \
  || { echo "ERROR: BASE_SNAPSHOT_ID is required (the base already contains the Zed stack)" >&2; exit 1; }

echo "▶ zed derive is RETIRED — the base bake installs the Zed stack (deploy/bake-install.sh)"
echo "  nothing to derive; unset DROPLET_SNAPSHOT_ID_ZED or point it at the base."
echo "✅ zed snapshot = base snapshot (image id: $BASE_SNAPSHOT_ID)"
