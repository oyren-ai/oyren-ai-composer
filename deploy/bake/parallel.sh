#!/usr/bin/env bash
# Named background jobs for the snapshot bake. SOURCE this file — never execute it.
#
# WHY THIS EXISTS
# The bake runs on the SMALLEST droplet (s-1vcpu-1gb + a 4GB swapfile), because that droplet's 25GB
# disk is what sets the minimum size of every session droplet — it cannot simply be made bigger.
# One vCPU means CPU-bound work gets NOTHING from parallelism. But the bake also spends minutes
# blocked on the network and on dpkg while that vCPU idles: the cloud-init/apt wait, tarball
# downloads, vendor installers. Overlapping THOSE with unrelated work is the win, and this helper is
# how it happens without turning the log into interleaved mush.
#
# WHY NOT A BARE `cmd &` + `wait`
# `set -euo pipefail` does not cover a backgrounded command: `cmd &` never trips errexit, and a bare
# `wait` discards the job's exit status entirely — a failed install would sail past as a success and
# get baked into the snapshot. So every job here:
#   1. writes its stdout AND stderr to its own file, never to the shared terminal, so two jobs can
#      never interleave into a log where you cannot tell which install failed;
#   2. is waited on individually by name, with its real exit status returned to the caller, so the
#      surrounding `set -e` still kills the bake;
#   3. has its whole log replayed at the wait point, in one block, under a header naming the job.
#
# MEMORY IS THE OTHER LIMIT. 1GB of RAM behind 4GB of swap does not fit two heavy Node installs at
# once (see install-agents.sh's NODE_OPTIONS comment — V8 already OOMed one bake here). The rule the
# callers follow: at most ONE node/JS package-manager process at a time; background jobs are curl,
# tar, dpkg and vendor binaries, which peak far below that.
#
# Usage:
#   . "$APP_DIR/deploy/bake/parallel.sh"
#   bg_start fetch-things curl -fsSL -o /tmp/x https://…   # or: bg_start name bash -c '…'
#   …foreground work…
#   bg_wait fetch-things        # replays its log, returns its exit status
#   bg_wait_all                 # same for everything still running, in start order

# Where each job's captured output lands. Kept out of the image by the bake's final cleanup.
BAKE_JOB_LOG_DIR="${BAKE_JOB_LOG_DIR:-/var/log/oyren-bake}"

_bg_names=()
_bg_pids=()
_bg_start_at=()

# bg_start <name> <command> [args…] — run a command in the background under a name.
# The name must be filename-safe: it IS the log file's name, and a caller typo that silently wrote
# somewhere else would lose the only record of what the job did.
bg_start() {
  local name="${1:-}"
  shift || true
  case "$name" in
    "" | *[!A-Za-z0-9._-]* )
      echo "ERROR: bg_start needs a [A-Za-z0-9._-] job name, got '${name}'" >&2
      return 2 ;;
  esac
  [ "$#" -gt 0 ] || { echo "ERROR: bg_start '$name' needs a command to run" >&2; return 2; }

  mkdir -p "$BAKE_JOB_LOG_DIR"
  local log="$BAKE_JOB_LOG_DIR/$name.log"
  : > "$log"
  # A subshell, so a shell FUNCTION works as the command just as well as an external program, and
  # so the job cannot leak `cd`/variable changes back into the caller.
  #
  # </dev/null IS LOAD-BEARING, not tidiness. provision-remote.sh is streamed into `bash -s` over
  # SSH (lib.sh run_remote), which means the shell running this bake is READING ITS OWN SCRIPT FROM
  # STDIN. A background job that inherited that stdin and read a single byte — a vendor installer
  # prompting, `apt-get` asking a question, anything — would eat the rest of the bake script and the
  # bake would die somewhere impossible to explain. Every job gets an empty stdin instead.
  ( "$@" ) </dev/null >"$log" 2>&1 &
  _bg_names+=("$name")
  _bg_pids+=("$!")
  _bg_start_at+=("$(date +%s)")
  echo "   ⏵ background: '$name' started (pid $!) — its output replays in full when it is waited on"
}

# _bg_index <name> — echo the slot index for a started job, or fail.
_bg_index() {
  local i
  for i in "${!_bg_names[@]}"; do
    [ "${_bg_names[$i]}" = "$1" ] && { printf '%s\n' "$i"; return 0; }
  done
  return 1
}

# bg_wait <name> — wait for one job, replay its captured output, return ITS exit status.
# Waiting twice is a no-op that returns 0: bg_wait_all after an explicit bg_wait must not hang.
bg_wait() {
  local name="$1" i pid rc dur log
  i="$(_bg_index "$name")" || { echo "ERROR: no background job named '$name' was started" >&2; return 2; }
  pid="${_bg_pids[$i]}"
  [ -n "$pid" ] || return 0

  # `wait` in a `&& … || …` list, never bare: bare, a non-zero status trips the caller's errexit
  # before this function can label WHICH job failed, which is the whole point of the helper.
  wait "$pid" && rc=0 || rc=$?
  _bg_pids[$i]=""
  dur=$(( $(date +%s) - ${_bg_start_at[$i]} ))
  log="$BAKE_JOB_LOG_DIR/$name.log"

  echo "──────── background job '$name' (${dur}s) ────────"
  [ -s "$log" ] && cat "$log"
  echo "──────── end '$name' ────────"
  if [ "$rc" -eq 0 ]; then
    echo "✅ background job '$name' finished ok in ${dur}s"
  else
    echo "❌ background job '$name' FAILED (exit $rc) after ${dur}s — its full output is directly above" >&2
  fi
  return "$rc"
}

# bg_wait_all — wait for every unreaped job in START order, then return the FIRST failure's status.
# Every job is waited on even after one fails: leaving a live child writing into a droplet that is
# about to be snapshotted is how half-written files get baked into an image.
bg_wait_all() {
  local i rc=0 r
  for i in "${!_bg_names[@]}"; do
    [ -n "${_bg_pids[$i]}" ] || continue
    bg_wait "${_bg_names[$i]}" && r=0 || r=$?
    [ "$rc" -eq 0 ] && rc="$r"
  done
  return "$rc"
}
