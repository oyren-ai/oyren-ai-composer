#!/usr/bin/env bash
# SOURCE this file. Agent-specific runtime env for LOGIN SHELLS. That is the whole population this
# reaches: systemd units read /etc/oyren/host.env, and the runtime's headless `claude` is the
# in-process Agent SDK, which never sources a profile at all.
#
# NOT set here, deliberately: CLAUDE_CODE_DISABLE_MOUSE / CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN. They
# were added for "the sandbox drives claude headlessly over a pipe" — but the headless path never
# read them, so the only processes they ever reached were the INTERACTIVE TUIs. With mouse
# reporting off, Claude Code never asks for mouse events, so tmux (mouse on, for the web terminal's
# scrollback) swallows every drag into its own copy-mode — clicking to place the cursor and
# selecting text inside the TUI both did nothing. Leaving them unset lets Claude request tracking
# and tmux forward it; a browser-native selection is still available with shift-drag.

write_agents_profile() {
  cat > /etc/profile.d/20-oyren-agents.sh <<'EOF'
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
export AGY_BIN=/usr/local/bin/agy
# The pinned claude is installed by root (the bake and `oyren update` ARE the update channel), so
# its self-updater cannot write its own prefix and every session footer would show "Auto-update
# failed: no write permission to npm prefix". seedClaudeSettings.js also puts this in
# ~/.claude/settings.json env for the non-login spawns (the editor extension, systemd units); this
# line covers the LOGIN shells that file cannot be trusted for.
export DISABLE_AUTOUPDATER=1
export IS_SANDBOX=1
EOF
  chmod 0644 /etc/profile.d/20-oyren-agents.sh
}
