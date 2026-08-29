#!/usr/bin/env bash
# SOURCE this file. Status + log for the in-place updater. Every state change lands in the status
# file (readable by the sandbox user, so the runtime's `update/status` control action and `oyren
# update --status` can show it), in the log, and, best-effort, at the orchestrator's
# /sandbox/update-result. Nothing here may abort the update: reporting is `|| true` throughout.
#
# Env overrides (tests, dry runs): OYREN_UPDATE_STATUS, OYREN_UPDATE_LOG, OYREN_SANDBOX_ENV.

STATUS_FILE="${OYREN_UPDATE_STATUS:-/etc/oyren/update-status.json}"
LOG_FILE="${OYREN_UPDATE_LOG:-/var/log/oyren-update.log}"
SANDBOX_ENV_FILE="${OYREN_SANDBOX_ENV:-/etc/oyren/sandbox.env}"
STATUS_MJS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/updateStatus.mjs"

log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  echo "$line"
  { mkdir -p "$(dirname "$LOG_FILE")" && printf '%s\n' "$line" >> "$LOG_FILE" && chmod 0644 "$LOG_FILE"; } 2>/dev/null || true
}

# status_write <state> <step> [--key value…] — merge into the status file, then report.
status_write() {
  local state="$1" step="$2"
  shift 2
  mkdir -p "$(dirname "$STATUS_FILE")" 2>/dev/null || true
  node "$STATUS_MJS" write --file "$STATUS_FILE" --state "$state" --step "$step" --log "$LOG_FILE" "$@" >/dev/null || true
  status_report
}

status_fail() { # status_fail <step> <message>
  log "FAILED at $1: $2"
  status_write failed "$1" --error "$2"
}

status_report() {
  if [ -f "$SANDBOX_ENV_FILE" ]; then
    node "$STATUS_MJS" report --file "$STATUS_FILE" --sandbox-env "$SANDBOX_ENV_FILE" >/dev/null 2>&1 || true
  fi
}

status_read() {
  node "$STATUS_MJS" read --file "$STATUS_FILE" 2>/dev/null || echo '{"state":"idle","note":"no update has run on this machine"}'
}

# status_field <name> — one field of the current status, empty when absent.
status_field() {
  node -e 'try { const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = s[process.argv[2]]; if (v != null) process.stdout.write(String(v)) } catch {}' "$STATUS_FILE" "$1"
}
