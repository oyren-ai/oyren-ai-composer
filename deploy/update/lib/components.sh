#!/usr/bin/env bash
# SOURCE this file. The one table that says, for every manifest component, how it is applied on a
# live droplet and what has to restart afterwards. apply-release.sh walks COMPONENT_ORDER so that
# the host toolchain moves first, the runtime last (its restart is the one users notice), and the
# agent CLIs go through live-agents.sh in a single call.
#
# Paths are relative to the release tree being applied ($NEW_ROOT), which is the TARGET version.

COMPONENT_ORDER="node host pnpm claude codex codexAcp gemini opencode qwen antigravityAcp dsh bun playwrightMcp zed kasmvnc browser lean editor runtime"

# apply_kind <component> → host | agents | zed | browser | lean | editor | runtime | refuse
apply_kind() {
  case "$1" in
    node) echo refuse ;;
    host|pnpm) echo host ;;
    claude|codex|codexAcp|gemini|opencode|qwen|antigravityAcp|dsh|bun|playwrightMcp) echo agents ;;
    zed|kasmvnc) echo zed ;;
    browser) echo browser ;;
    lean) echo lean ;;
    editor) echo editor ;;
    runtime) echo runtime ;;
    *) echo unknown ;;
  esac
}

# apply_group <kind> <new-root> <component…> — run the installer for one kind, once.
apply_group() {
  local kind="$1" root="$2"
  shift 2
  case "$kind" in
    host) bash "$root/deploy/sandbox-host/install-host.sh" ;;
    agents) bash "$root/deploy/sandbox-host/live-agents.sh" "$@" ;;
    zed) SEED_USER_FILES=0 bash "$root/deploy/zed/install-zed.sh" ;;
    browser) bash "$root/deploy/browser/install-browser.sh" ;;
    lean) bash "$root/deploy/lean/live-lean.sh" ;;
    editor) bash "$root/deploy/editor/live-editor.sh" ;;
    runtime) bash "$root/deploy/sandbox-host/install-runtime.sh" ;;
    *) echo "ERROR: no live path for '$kind'" >&2; return 1 ;;
  esac
}

# restart_for <component> → the units a change to it needs restarted (space-separated, may be empty).
restart_for() {
  case "$1" in
    runtime|host|pnpm) echo "oyren-sandbox" ;;
    editor) echo "oyren-editor" ;;
    zed|kasmvnc) echo "oyren-zed" ;;
    browser) echo "oyren-browser" ;;
    *) echo "" ;;
  esac
}

# refuse_reason <component> — why a component cannot move in place (empty when it can).
refuse_reason() {
  case "$1" in
    node) echo "a Node.js major upgrade needs a fresh Codespace: every native module on this machine was built against the current one" ;;
    *) echo "" ;;
  esac
}
