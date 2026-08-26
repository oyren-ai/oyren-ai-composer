#!/usr/bin/env bash
# Install every coding-agent CLI onto the sandbox droplet.
#
# One snapshot carries all of them, so a launch picks its agent purely at runtime via AGENT_KIND —
# which the sandbox entrypoint already reads. That is what retires the old per-(agent,format) image
# matrix: 7 agents x 4 formats was 28 images to build and push, now it is one snapshot re-baked by
# hand when a version should move.
#
# Versions are PINNED, exactly as the per-agent Dockerfiles pinned them. Agent CLIs ship breaking
# changes often and a floating tag turns a re-bake into a silent upgrade of every future sandbox.
# Bump deliberately, one at a time, and re-bake. The pins live in deploy/versions.env, one file for
# every installer and for the image manifest; an exported variable of the same name still wins.
#
# Idempotent: safe to re-run. Runs as root during the snapshot bake.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib/versions.sh"
load_versions
STAMP="$HERE/../manifest/stamp.sh"

SANDBOX_USER="${SANDBOX_USER:-oyren}"
DSH_DIR="${DSH_DIR:-/opt/oyren-dsh}"
export PNPM_HOME="${PNPM_HOME:-/usr/local/share/pnpm}"
export PATH="$PNPM_HOME:$PATH"
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# The bake runs on a 1GB droplet — its 25GB disk is what caps the minimum session droplet size, so
# it cannot simply be given more RAM. V8 sizes its default heap from physical memory and lands at
# ~490MB there, which installing claude-code alone exceeds; the first bake died exactly there.
# The 4GB swapfile does NOT help on its own: max-old-space-size is a hard V8 ceiling enforced
# regardless of available memory. Raise the ceiling and let swap absorb anything past physical RAM.
export NODE_OPTIONS="--max-old-space-size=3072${NODE_OPTIONS:+ $NODE_OPTIONS}"

# Every pnpm-installed agent CLI in ONE `pnpm add -g` pass, not one per package. Each call
# re-resolves and re-links the whole global set, and on this 1-vCPU droplet that trailing link phase
# cost 20-45s EVERY time: seven separate calls spent ~275s of the last bake where one pass downloads
# once and links once. Same pins, same resulting tree.
#
# --allow-build is per PACKAGE NAME, and pnpm 10 merges every value into one onlyBuiltDependencies
# allowlist for the whole install — so the list below is exactly the union of what the separate
# calls allowed (checked against pnpm 10.33.0: claude's native binary links, and the ignored-build
# list comes out identical). It is also why dsh is NOT in this pass: see below.
#
# HOME=/root keeps pnpm's store and logs out of the sandbox user's home, where they would otherwise
# land root-owned and break the agent's first write.
echo "==> agent CLIs, one pnpm pass: claude ${CLAUDE_VERSION}, codex ${CODEX_VERSION} (+ acp ${CODEX_ACP_VERSION}), gemini ${GEMINI_VERSION}, opencode ${OPENCODE_VERSION}, qwen ${QWEN_VERSION}, antigravity-acp ${ANTIGRAVITY_ACP_VERSION}"
# Each CLI's own package is allowed to build, exactly what the per-package calls allowed;
# antigravity-acp keeps no allow-build, as it never had one.
HOME=/root pnpm add -g \
  --allow-build=@anthropic-ai/claude-code \
  --allow-build=@openai/codex \
  --allow-build=@agentclientprotocol/codex-acp \
  --allow-build=@google/gemini-cli \
  --allow-build=opencode-ai \
  --allow-build=@qwen-code/qwen-code \
  "@anthropic-ai/claude-code@${CLAUDE_VERSION}" \
  "@openai/codex@${CODEX_VERSION}" \
  "@agentclientprotocol/codex-acp@${CODEX_ACP_VERSION}" \
  "@google/gemini-cli@${GEMINI_VERSION}" \
  "opencode-ai@${OPENCODE_VERSION}" \
  "@qwen-code/qwen-code@${QWEN_VERSION}" \
  "antigravity-acp@${ANTIGRAVITY_ACP_VERSION}"
# `claude` is a 500-byte SHIM until the package's postinstall links the platform-native binary
# (@anthropic-ai/claude-code-linux-x64) into bin/. Without --allow-build above pnpm skips that
# script and the shim survives the bake, so every session gets a `claude` that only prints
# "claude native binary not installed" — which is exactly how it reached a live sandbox once.
# Run it, don't just look for the file: only executing proves the native binary is really there.
CLAUDE_SMOKE="$(HOME=/root timeout 60 claude --version 2>&1 || true)"
case "$CLAUDE_SMOKE" in
  *"$CLAUDE_VERSION"*) echo "    claude smoke: $CLAUDE_SMOKE" ;;
  *) echo "ERROR: claude does not run after install (native binary not linked?): $CLAUDE_SMOKE" >&2; exit 1 ;;
esac

# DeepSeek Harness — pnpm as well, but into its OWN project under /opt rather than the global set.
# The global allowlist is one list for the whole install, and dsh's names node-pty and protobufjs,
# which CLIs above also depend on with their builds deliberately skipped: a `pnpm add -g` of dsh
# (in the pass above or after it) quietly gyp-builds claude's node-pty@1.0.0 too — seen in a local
# run. A private project keeps the two allowlists apart and never re-links the global tree, so this
# costs dsh's own install and nothing else. The wrapper below is a script, not a symlink: pnpm's
# .bin shim locates its package relative to $0.
#
# It used to be the one npm install in this file, on the belief that pnpm's isolated store broke its
# Cordis plugin loader (ERR_MODULE_NOT_FOUND on the first bundle). Re-tested 2026-08-21 with this
# exact pnpm pin: `dsh --version`, `dsh --help` and `dsh --profile web` all boot from a pnpm install,
# and npm's tree was never flat for it anyway (194 packages nested under dsh/node_modules). On
# linux-x64 the build scripts its native seams declare (node-pty, koffi, the local subprocess
# backend, @google/genai, protobufjs) are no-ops today — every one ships a prebuilt binary — but
# naming them is what keeps a later rc that genuinely needs a build from installing silently
# half-built. Its published tag IS a developer-preview rc, which is also why the pin matters more
# here than anywhere else in this file.
echo "==> deepseek harness ${DSH_VERSION} -> ${DSH_DIR}"
rm -rf "$DSH_DIR"
install -d -m 0755 "$DSH_DIR"
printf '{ "name": "oyren-dsh", "private": true }\n' > "$DSH_DIR/package.json"
(cd "$DSH_DIR" && HOME=/root pnpm add \
  --allow-build=@deepseek-ai/dsh-subprocess-local \
  --allow-build=koffi \
  --allow-build=node-pty \
  --allow-build=@google/genai \
  --allow-build=protobufjs \
  "@deepseek-ai/dsh@${DSH_VERSION}")
printf '%s\n' '#!/bin/sh' "exec \"${DSH_DIR}/node_modules/.bin/dsh\" \"\$@\"" > /usr/local/bin/dsh
chmod 0755 /usr/local/bin/dsh
# Same reasoning as claude's smoke check above: only running it proves the install is usable — a
# half-resolved plugin tree still leaves a `dsh` on PATH that dies on its first boot.
DSH_SMOKE="$(HOME=/root timeout 60 dsh --version 2>&1 || true)"
case "$DSH_SMOKE" in
  *"$DSH_VERSION"*) echo "    dsh smoke: $DSH_SMOKE" ;;
  *) echo "ERROR: dsh does not run after install: $DSH_SMOKE" >&2; exit 1 ;;
esac

echo "==> cursor (vendor installer — no pinned version available)"
su - "$SANDBOX_USER" -c 'curl https://cursor.com/install -fsS | bash'
ln -sf "/home/$SANDBOX_USER/.local/bin/agent" /usr/local/bin/agent
ln -sf "/home/$SANDBOX_USER/.local/bin/cursor-agent" /usr/local/bin/cursor-agent

echo "==> antigravity (+ bun ${BUN_VERSION}, its acp shim needs it)"
curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin
# The installer ignores --dir and drops the binary in $HOME/.local/bin — which is /root here, a
# directory the sandbox user cannot read. In the container this was masked because the install ran
# as `oyren`; on the VM it runs as root, so AGY_BIN would point at a path the agent can't execute.
if [ ! -x /usr/local/bin/agy ]; then
  AGY_SRC="$(command -v agy || true)"
  [ -n "$AGY_SRC" ] || AGY_SRC=/root/.local/bin/agy
  if [ -x "$AGY_SRC" ]; then
    install -m 0755 "$AGY_SRC" /usr/local/bin/agy
    echo "    relocated agy from $AGY_SRC"
  else
    echo "    WARNING: agy binary not found — antigravity launches will fail" >&2
  fi
fi
apt-get -o DPkg::Lock::Timeout=300 install -y -qq --no-install-recommends unzip
curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s -- "$BUN_VERSION"
apt-get -y -qq purge unzip && apt-get -y -qq autoremove
# antigravity-acp itself landed in the pnpm pass above; bun is only what its shim needs at runtime.

# Chromium for claude's playwright MCP. Shared, world-readable, outside any home dir so every agent
# reuses one copy instead of downloading ~150MB on first use.
echo "==> playwright MCP ${PLAYWRIGHT_MCP_VERSION} + chromium"
HOME=/root npm install -g "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}"
# The Dockerfile hardcoded /usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright-core/
# cli.js. TWO assumptions in that path break on a VM, and each killed a bake:
#   1. the prefix — node:24 images use /usr/local, but NodeSource Ubuntu installs globals under
#      /usr, so the directory did not exist at all;
#   2. the nesting — npm hoists playwright-core to the global root here rather than nesting it
#      under the mcp package.
# So resolve both dynamically: ask npm for its global root, then ask node where the mcp package
# would actually load playwright-core from, with a search as the last resort.
NPM_ROOT="$(npm root -g)"
PW_MCP_DIR="$NPM_ROOT/@playwright/mcp"
PW_CORE="$(node -e "console.log(require.resolve('playwright-core/cli.js',{paths:['$PW_MCP_DIR']}))" 2>/dev/null || true)"
[ -n "$PW_CORE" ] || PW_CORE="$(find "$NPM_ROOT" -path '*playwright-core/cli.js' -print -quit 2>/dev/null || true)"
[ -n "$PW_CORE" ] || { echo "ERROR: playwright-core cli.js not found after install" >&2; exit 1; }
echo "    playwright-core cli: $PW_CORE"
apt-get -o DPkg::Lock::Timeout=300 update -qq
HOME=/root node "$PW_CORE" install-deps chromium
HOME=/root node "$PW_CORE" install --no-shell chromium
chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"

# Agent-specific runtime env for LOGIN SHELLS. That is the whole population this file reaches:
# systemd units read /etc/oyren/host.env, and the runtime's headless `claude` is the in-process Agent
# SDK, which never sources a profile at all.
#
# NOT set here, deliberately: CLAUDE_CODE_DISABLE_MOUSE / CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN. They
# were added for "the sandbox drives claude headlessly over a pipe" — but the headless path never
# read them (see above), so the only processes they ever reached were the INTERACTIVE TUIs: the
# `claude` in the tmux pane and the one a user starts in a terminal. With mouse reporting off, Claude
# Code never asks for mouse events, so tmux (mouse on, for the web terminal's scrollback) swallows
# every drag into its own copy-mode — clicking to place the cursor and selecting text inside the TUI
# both did nothing. Leaving them unset lets Claude request tracking and tmux forward it; a
# browser-native selection is still available with shift-drag, as in any mouse-tracking TUI.
cat > /etc/profile.d/20-oyren-agents.sh <<'EOF'
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
export AGY_BIN=/usr/local/bin/agy
# The pinned claude is installed by root (this script IS the update channel — bump + re-bake), so
# its self-updater cannot write its own prefix and every session footer shows
# "Auto-update failed: no write permission to npm prefix · Run claude doctor".
# seedClaudeSettings.js already puts this in ~/.claude/settings.json env, which is what covers the
# non-login spawns (the editor extension, systemd units); this line covers the LOGIN shells that
# file cannot be trusted for — a user's own settings.json write can drop it, and a session booted
# from a snapshot older than that seeder never had it at all.
export DISABLE_AUTOUPDATER=1
export IS_SANDBOX=1
EOF
chmod 0644 /etc/profile.d/20-oyren-agents.sh

rm -rf /var/lib/apt/lists/* "/home/$SANDBOX_USER/.npm"
install -d -o "$SANDBOX_USER" -g "$SANDBOX_USER" "/home/$SANDBOX_USER/.cache"
chown -R "$SANDBOX_USER:$SANDBOX_USER" "$PNPM_HOME"

# Stamp every pinned CLI into the image manifest (deploy/manifest/), one component each, so a live
# update that bumps a single pin can re-run just that install and record just that change. cursor
# and agy have no pin (vendor installers) and are deliberately not components.
"$STAMP" claude "$CLAUDE_VERSION"
"$STAMP" codex "$CODEX_VERSION"
"$STAMP" codexAcp "$CODEX_ACP_VERSION"
"$STAMP" gemini "$GEMINI_VERSION"
"$STAMP" opencode "$OPENCODE_VERSION"
"$STAMP" qwen "$QWEN_VERSION"
"$STAMP" dsh "$DSH_VERSION"
"$STAMP" antigravityAcp "$ANTIGRAVITY_ACP_VERSION"
"$STAMP" playwrightMcp "$PLAYWRIGHT_MCP_VERSION"
"$STAMP" bun "$BUN_VERSION"

echo "✅ agent CLIs installed (claude codex gemini cursor opencode qwen antigravity deepseek-harness)"