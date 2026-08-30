#!/usr/bin/env bash
# Clone the repo(s) into $OYREN_WORKSPACE_DIR/<repo-name> sibling folders (if creds + names are
# present and the folder doesn't exist yet), then start the sandbox server. That directory is the
# parent that CONTAINS the repo folders — not a repo root itself. Never echo GITHUB_TOKEN /
# REPO_CLONE_TOKENS.
# Multi-repo launches send REPO_FULL_NAMES / REPO_CLONE_TOKENS (aligned comma-separated lists, primary
# first); single-repo launches send only REPO_FULL_NAME / GITHUB_TOKEN — both paths stay supported.
set -euo pipefail

# Under the sandbox user's home so the browser editor (same user) owns what it writes; /workspace is
# a symlink to it, so absolute paths in skills and AGENTS.md keep working.
WORKSPACE="${OYREN_WORKSPACE_DIR:-/home/oyren/workspace}"
mkdir -p "$WORKSPACE"

# Keep heavy Node-based test/build commands from OOM-killing the whole agent container.
# Callers can override either by setting OYREN_NODE_HEAP_MB or by passing an explicit
# --max-old-space-size in NODE_OPTIONS.
if [[ " ${NODE_OPTIONS:-} " != *" --max-old-space-size="* ]]; then
  export NODE_OPTIONS="--max-old-space-size=${OYREN_NODE_HEAP_MB:-4096}${NODE_OPTIONS:+ $NODE_OPTIONS}"
fi

# Clone one repo into its sibling folder ($1 = owner/repo, $2 = token or empty), then strip the token
# from the stored remote so it never lingers in .git/config. Push still works: the `oyren` git
# credential helper (configured system-wide in the image) supplies GITHUB_TOKEN on demand, so the
# remote stays credential-less on disk while pushes/pulls authenticate.
clone_repo() {
  local full_name="$1" token="$2" dir
  dir="$WORKSPACE/$(basename "$full_name")"
  if [ ! -e "$dir" ]; then
    if [ -n "$token" ]; then
      echo "Cloning ${full_name} (authenticated)…"
      git clone --depth 1 "https://x-access-token:${token}@github.com/${full_name}.git" "$dir" \
        || echo "⚠️  clone of ${full_name} failed; continuing"
    else
      echo "Cloning ${full_name} (public)…"
      git clone --depth 1 "https://github.com/${full_name}.git" "$dir" \
        || echo "⚠️  clone of ${full_name} failed; continuing"
    fi
  fi
  if [ -d "$dir/.git" ]; then
    git -C "$dir" remote set-url origin "https://github.com/${full_name}.git" 2>/dev/null || true
  fi
}

REPO_DIR=""
if [ -n "${REPO_FULL_NAMES:-}" ]; then
  IFS=',' read -r -a _repo_names <<< "$REPO_FULL_NAMES"
  IFS=',' read -r -a _repo_tokens <<< "${REPO_CLONE_TOKENS:-}"
  for i in "${!_repo_names[@]}"; do
    clone_repo "${_repo_names[$i]}" "${_repo_tokens[$i]:-${GITHUB_TOKEN:-}}"
  done
  REPO_DIR="$WORKSPACE/$(basename "${_repo_names[0]}")" # primary drives the default working dir
elif [ -n "${REPO_FULL_NAME:-}" ]; then
  clone_repo "$REPO_FULL_NAME" "${GITHUB_TOKEN:-}"
  REPO_DIR="$WORKSPACE/$(basename "$REPO_FULL_NAME")"
fi

# The repo folder is the effective project root: unless the orchestrator overrode them, point the
# server's WORKDIR (terminal cwd, oyren manifest resolution, headless agent turns) and the agent's
# WORKING_DIR there, so sessions still open at the repo root despite the subfolder layout. A launch
# that chose "Top level" over 2+ repos sends WORKDIR/WORKING_DIR=$WORKSPACE from the orchestrator; the
# `:-` keeps that override so the session opens at the parent and sees every clone as a sibling.
if [ -n "$REPO_DIR" ] && [ -d "$REPO_DIR" ]; then
  export WORKDIR="${WORKDIR:-$REPO_DIR}"
  export WORKING_DIR="${WORKING_DIR:-$REPO_DIR}"
fi

# The tmux server lives in its own unit (oyren-tmux.service) so a restart of THIS unit — an in-place
# update, a crash-restart — keeps every shell and the running agent; the web terminal re-attaches.
# Wait for its socket, then hand it the values only this script knows (computed after the clone),
# which new panes inherit from the server. An image without the unit still gets a server the old
# way, inside this cgroup, from the first `tmux new-session` below or in terminalSpawn.js.
if systemctl is-active --quiet oyren-tmux 2>/dev/null; then
  _sock="/tmp/tmux-$(id -u)/default"
  for _i in $(seq 1 25); do [ -S "$_sock" ] && break; sleep 0.2; done
  tmux set-environment -g WORKDIR "${WORKDIR:-$WORKSPACE}" 2>/dev/null || true
  tmux set-environment -g WORKING_DIR "${WORKING_DIR:-$WORKSPACE}" 2>/dev/null || true
  tmux set-environment -g NODE_OPTIONS "$NODE_OPTIONS" 2>/dev/null || true
  # Remember what only this script can compute (values arrive after the clone), for the restore
  # that runs when the SERVER restarts without us: tmux-state.mjs re-seeds these globals and puts
  # the agent back into main:0.0 at WORKING_DIR.
  if [ -f /usr/local/lib/oyren/tmux-state.mjs ]; then
    WORKDIR="${WORKDIR:-$WORKSPACE}" WORKING_DIR="${WORKING_DIR:-$WORKSPACE}" \
      node /usr/local/lib/oyren/tmux-state.mjs remember 2>/dev/null || true
  fi
fi

# Agent launch: when the orchestrator requested a CLI agent, pre-create the tmux "main" session running
# it now. server.js's `tmux new-session -A -s main` then *attaches* to it, so the browser lands on the
# already-running agent. Absent AGENT_KIND ⇒ no pre-create ⇒ server.js makes a plain shell (unchanged).
# After a runtime restart the session already exists (it outlived us in oyren-tmux.service), and
# `new-session -d -s main` fails on the duplicate name, which the `|| true` was already absorbing.
if [ -n "${AGENT_KIND:-}" ]; then
  mkdir -p "${WORKING_DIR:-$WORKSPACE}" # never let a not-yet-existing start dir silently skip the launch
  tmux -u new-session -d -s main -c "${WORKING_DIR:-$WORKSPACE}" "/app/agent-launch.sh" || true
fi

exec node /app/src/server.js
