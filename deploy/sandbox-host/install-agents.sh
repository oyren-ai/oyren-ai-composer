#!/usr/bin/env bash
# Install every coding-agent CLI onto the sandbox droplet.
#
# One snapshot carries all of them, so a launch picks its agent purely at runtime via AGENT_KIND —
# which the sandbox entrypoint already reads. That is what retires the old per-(agent,format) image
# matrix: 7 agents x 4 formats was 28 images to build and push, now it is one snapshot re-baked
# when a version should move.
#
# Versions are PINNED in deploy/versions.env (an exported variable of the same name still wins).
# Agent CLIs ship breaking changes often and a floating tag turns a re-bake into a silent upgrade
# of every future sandbox. Bump deliberately, one at a time, and re-bake — or let a live Codespace
# take just that component through `oyren update` (live-agents.sh).
#
# The work lives in agents/*.sh as functions shared with live-agents.sh; this script is the bake's
# order of operations. Idempotent. Runs as root during the snapshot bake.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib/versions.sh"
load_versions
STAMP="$HERE/../manifest/stamp.sh"

SANDBOX_USER="${SANDBOX_USER:-oyren}"
DSH_DIR="${DSH_DIR:-/opt/oyren-dsh}"
export SANDBOX_USER
export PNPM_HOME="${PNPM_HOME:-/usr/local/share/pnpm}"
export PATH="$PNPM_HOME:$PATH"
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# The bake runs on a 1GB droplet — its 25GB disk is what caps the minimum session droplet size, so
# it cannot simply be given more RAM. V8 sizes its default heap from physical memory and lands at
# ~490MB there, which installing claude-code alone exceeds; the first bake died exactly there.
# The 4GB swapfile does NOT help on its own: max-old-space-size is a hard V8 ceiling enforced
# regardless of available memory. Raise the ceiling and let swap absorb anything past physical RAM.
export NODE_OPTIONS="--max-old-space-size=3072${NODE_OPTIONS:+ $NODE_OPTIONS}"

source "$HERE/agents/pnpm-clis.sh"
source "$HERE/agents/dsh.sh"
source "$HERE/agents/vendor.sh"
source "$HERE/agents/playwright.sh"
source "$HERE/agents/profile.sh"

echo "==> agent CLIs, one pnpm pass: claude ${CLAUDE_VERSION}, codex ${CODEX_VERSION} (+ acp ${CODEX_ACP_VERSION}), gemini ${GEMINI_VERSION}, opencode ${OPENCODE_VERSION}, qwen ${QWEN_VERSION}, antigravity-acp ${ANTIGRAVITY_ACP_VERSION}"
agent_pnpm_all
claude_smoke

install_dsh "$DSH_VERSION" "$DSH_DIR"
install_cursor
install_agy
install_bun "$BUN_VERSION"
install_playwright_mcp "$PLAYWRIGHT_MCP_VERSION"
write_agents_profile

rm -rf /var/lib/apt/lists/* "/home/$SANDBOX_USER/.npm"
install -d -o "$SANDBOX_USER" -g "$SANDBOX_USER" "/home/$SANDBOX_USER/.cache"
chown -R "$SANDBOX_USER:$SANDBOX_USER" "$PNPM_HOME"

# Stamp every pinned CLI into the image manifest (deploy/manifest/), one component each, so a live
# update that bumps a single pin can re-run just that install and record just that change. cursor
# and agy have no pin (vendor installers) and are deliberately not components.
for c in $AGENT_PNPM_COMPONENTS; do "$STAMP" "$c" "$(agent_version_of "$c")"; done
"$STAMP" dsh "$DSH_VERSION"
"$STAMP" playwrightMcp "$PLAYWRIGHT_MCP_VERSION"
"$STAMP" bun "$BUN_VERSION"

echo "✅ agent CLIs installed (claude codex gemini cursor opencode qwen antigravity deepseek-harness)"
