#!/usr/bin/env bash
# SOURCE this file after deploy/lib/versions.sh has loaded the pins. The pnpm-global agent CLIs:
# which package each manifest component is, its pinned version, and the two ways to install them.
#
# `agent_pnpm_all` is the bake's ONE `pnpm add -g` pass: each call re-resolves and re-links the
# whole global set, and on the 1-vCPU bake droplet that trailing link phase cost 20-45s every time,
# so seven separate calls spent ~275s of a bake where one pass downloads once and links once.
# `agent_pnpm_one` is the live update's path: a single pin moved, so one package is re-added (the
# global set re-links once, which is fine for one component on a real session droplet).
#
# --allow-build is per PACKAGE NAME and pnpm 10 merges every value into one onlyBuiltDependencies
# allowlist for the install, so the flags below are exactly what the old per-package calls
# allowed. dsh is NOT in this set — see agents/dsh.sh for why it has its own project.
#
# HOME=/root keeps pnpm's store and logs out of the sandbox user's home, where they would otherwise
# land root-owned and break the agent's first write.

AGENT_PNPM_COMPONENTS="claude codex codexAcp gemini opencode qwen antigravityAcp"

agent_pkg_of() {
  case "$1" in
    claude) echo "@anthropic-ai/claude-code" ;;
    codex) echo "@openai/codex" ;;
    codexAcp) echo "@agentclientprotocol/codex-acp" ;;
    gemini) echo "@google/gemini-cli" ;;
    opencode) echo "opencode-ai" ;;
    qwen) echo "@qwen-code/qwen-code" ;;
    antigravityAcp) echo "antigravity-acp" ;;
    *) return 1 ;;
  esac
}

agent_version_of() {
  case "$1" in
    claude) echo "$CLAUDE_VERSION" ;;
    codex) echo "$CODEX_VERSION" ;;
    codexAcp) echo "$CODEX_ACP_VERSION" ;;
    gemini) echo "$GEMINI_VERSION" ;;
    opencode) echo "$OPENCODE_VERSION" ;;
    qwen) echo "$QWEN_VERSION" ;;
    antigravityAcp) echo "$ANTIGRAVITY_ACP_VERSION" ;;
    *) return 1 ;;
  esac
}

# Each CLI's own package may run its build script; antigravity-acp never had one.
agent_allow_build_flag() {
  [ "$1" = "antigravityAcp" ] && return 0
  printf -- '--allow-build=%s' "$(agent_pkg_of "$1")"
}

agent_pnpm_all() {
  local c flag args=()
  for c in $AGENT_PNPM_COMPONENTS; do
    flag="$(agent_allow_build_flag "$c")"
    [ -n "$flag" ] && args+=("$flag")
  done
  for c in $AGENT_PNPM_COMPONENTS; do args+=("$(agent_pkg_of "$c")@$(agent_version_of "$c")"); done
  HOME=/root pnpm add -g "${args[@]}"
}

agent_pnpm_one() {
  local c="$1" flag
  flag="$(agent_allow_build_flag "$c")"
  HOME=/root pnpm add -g ${flag:+"$flag"} "$(agent_pkg_of "$c")@$(agent_version_of "$c")"
}

# `claude` is a 500-byte SHIM until the package's postinstall links the platform-native binary into
# bin/. Without --allow-build pnpm skips that script and the shim survives, so every session gets a
# `claude` that only prints "claude native binary not installed" — which is exactly how it reached
# a live sandbox once. Run it, don't just look for the file: only executing proves the binary.
claude_smoke() {
  local smoke
  smoke="$(HOME=/root timeout 60 claude --version 2>&1 || true)"
  case "$smoke" in
    *"$CLAUDE_VERSION"*) echo "    claude smoke: $smoke" ;;
    *) echo "ERROR: claude does not run after install (native binary not linked?): $smoke" >&2; return 1 ;;
  esac
}
