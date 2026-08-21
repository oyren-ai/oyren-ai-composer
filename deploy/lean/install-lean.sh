#!/usr/bin/env bash
# Add Lean 4 + Mathlib to a sandbox droplet, producing the SECOND snapshot variant.
#
# This is NOT part of the base bake. Mathlib costs 3-5GB and only the Lean app needs it, so paying
# it on every launch is waste. Instead: bake the base snapshot once, boot one droplet from it, run
# this, and re-snapshot. The two snapshots then differ by exactly this script, and the orchestrator
# picks between them by runtime kind.
#
# Everything else the Lean app needs — the editor, the agent CLIs, the runtime — is already in the
# base snapshot, which is why deriving is cheap.
#
# Idempotent: safe to re-run. Runs as root, twice per Lean image: once on the lean-FOUNDATION bake
# (deploy/bake/foundation-remote.sh — stock Ubuntu plus the oyren user, no editor yet), then again at
# the end of the base provisioning that is laid on top of that foundation (bake-install.sh), which is
# when the editor exists for the infoview extension. The second pass must be cheap — see the Mathlib
# guard below. Also still works the old way, on a droplet booted from the base snapshot.
set -euo pipefail

SANDBOX_USER="${SANDBOX_USER:-oyren}"
EDITOR_DIR="${EDITOR_DIR:-/opt/openvscode-server}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_HOME="$(getent passwd "$SANDBOX_USER" | cut -d: -f6)"
# Resolved from the user's home, not the /workspace symlink, so the path baked into the template's
# AGENTS.md matches what the editor's file tree actually shows.
WORKSPACE_DIR="${OYREN_WORKSPACE_DIR:-$USER_HOME/workspace}"
LEAN_DIR="${LEAN_DIR:-$WORKSPACE_DIR/lean}"

echo "==> Lean project template -> ${LEAN_DIR}"
mkdir -p "$LEAN_DIR"
cp -a "$HERE/template/." "$LEAN_DIR"/
# Lean skills merge with the base image's /app/skills and are seeded into the agent's skills dir
# at launch, same as every other app's.
mkdir -p /app/skills
cp -a "$HERE/skills/." /app/skills/
chown -R "$SANDBOX_USER:$SANDBOX_USER" "$LEAN_DIR" /app/skills

# elan pins the toolchain from template/lean-toolchain. Mathlib in lakefile.toml is pinned to the
# SAME tag on purpose — bump both together, or `lake exe cache get` finds no prebuilt oleans and
# the build compiles Mathlib from source for hours instead of minutes.
echo "==> elan + toolchain $(cat "$LEAN_DIR/lean-toolchain")"
su - "$SANDBOX_USER" -c "curl -sSf https://elan.lean-lang.org/elan-init.sh \
  | sh -s -- -y --default-toolchain '$(cat "$LEAN_DIR/lean-toolchain")'"

# cache get pulls prebuilt oleans; lake build then warms everything so the FIRST launch already has
# a working language server instead of compiling on the user's first keystroke. The download cache
# is removed afterwards — only the unpacked oleans are what the server and lake actually use, and
# re-running `cache get` on a live droplet would just download it again.
#
# That deletion is also why a re-run must NOT call `cache get` once the oleans are in place: with the
# download cache gone it would refetch all of Mathlib. So the second pass only runs `lake build`, the
# cheap proof that the toolchain and oleans still load — and only if deploy/lean/ is byte-identical
# to what the foundation was built from. A changed pin with stale oleans would send `lake build` off
# compiling Mathlib from source for hours; failing loudly here is the right outcome for that.
LEAN_ENV="cd '$LEAN_DIR' && export PATH=\"\$HOME/.elan/bin:\$PATH\""
LEAN_STAMP=/etc/oyren/lean-foundation.sha256
LEAN_SUM="$(find "$HERE" -type f | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)"
if find "$LEAN_DIR/.lake/packages/mathlib/.lake/build" -name 'Mathlib.olean' 2>/dev/null | grep -q .; then
  if [ "$(cat "$LEAN_STAMP" 2>/dev/null)" != "$LEAN_SUM" ]; then
    echo "ERROR: deploy/lean/ changed since this foundation was baked — re-bake the lean foundation" >&2
    exit 1
  fi
  echo "==> Mathlib already built here — lake build only"
  su - "$SANDBOX_USER" -c "$LEAN_ENV && lake build"
else
  echo "==> Mathlib (cache get + build; several minutes)"
  su - "$SANDBOX_USER" -c "$LEAN_ENV && lake exe cache get && lake build && rm -rf \"\$HOME/.cache/mathlib\""
  mkdir -p /etc/oyren
  echo "$LEAN_SUM" > "$LEAN_STAMP"
fi

# The infoview extension needs the editor, which a foundation bake does not have yet; the base
# provisioning re-runs this script after the editor is installed, and that pass lands it.
if [ -x "$EDITOR_DIR/bin/openvscode-server" ]; then
  echo "==> vscode-lean4 extension (Open VSX — the infoview / goal state UI)"
  su - "$SANDBOX_USER" -c "'$EDITOR_DIR/bin/openvscode-server' --install-extension leanprover.lean4"
else
  echo "==> vscode-lean4 extension: no editor on this box yet — deferred to the provisioning pass"
fi

# The editor and the agent both start in the Lean project when no repo is cloned.
cat > /etc/profile.d/30-oyren-lean.sh <<EOF
export ELAN_HOME="${USER_HOME}/.elan"
export PATH="\$ELAN_HOME/bin:\$PATH"
EOF
chmod 0644 /etc/profile.d/30-oyren-lean.sh

echo "✅ Lean + Mathlib installed"