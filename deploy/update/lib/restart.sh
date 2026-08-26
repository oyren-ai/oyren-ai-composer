#!/usr/bin/env bash
# SOURCE this file. Restart what an update changed, in an order the user can live with: the editor
# first (it reloads its own tab), then zed/browser only if they are running, the sandbox runtime
# last — that one drops the web terminal's socket for a few seconds, and it is the one that gets a
# health check plus a rollback: if the new runtime does not answer with its own hash within a
# minute, the previous tree comes back and the update is reported failed.

HEALTH_URL="${OYREN_HEALTH_URL:-http://127.0.0.1:8080/_oyren/health}"

unit_active() { systemctl is-active --quiet "$1" 2>/dev/null; }

# restart_units <unit…> — dedup, order, restart. Units that are not running are left alone
# (except the sandbox unit, which must come back).
restart_units() {
  local ordered="" u
  for u in oyren-editor oyren-zed oyren-browser oyren-sandbox; do
    case " $* " in *" $u "*) ordered="$ordered $u" ;; esac
  done
  for u in $ordered; do
    if [ "$u" != "oyren-sandbox" ] && ! unit_active "$u"; then log "skip restart of $u (not running)"; continue; fi
    log "restarting $u"
    systemctl restart "$u" || log "restart of $u failed (continuing)"
  done
}

# wait_runtime_health <expected-runtime-hash> — up to 60 s for the new runtime to answer.
wait_runtime_health() {
  local want="$1" got i
  for i in $(seq 1 30); do
    got="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null | node -p 'try { JSON.parse(require("fs").readFileSync(0, "utf8")).runtime || "" } catch { "" }' 2>/dev/null || true)"
    [ "$got" = "$want" ] && return 0
    sleep 2
  done
  return 1
}

# rollback_runtime <previous-tree> <new-root> — re-point /app at the previous tree and restart.
rollback_runtime() {
  local previous="$1" root="$2"
  [ -n "$previous" ] && [ -d "$previous" ] || { log "no previous runtime to roll back to"; return 1; }
  # shellcheck disable=SC1091
  source "$root/deploy/sandbox-host/runtime-lib.sh"
  activate_runtime "$previous"
  systemctl restart oyren-sandbox || true
  log "rolled the runtime back to $previous"
}
