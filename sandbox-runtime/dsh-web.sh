#!/usr/bin/env bash
# oyren-dsh-web — serve the DeepSeek Harness (`dsh`) browser UI on the Codespace's dsh hostname.
#
# dsh is the odd one out among the baked agent CLIs: it ships no TUI and no ACP bridge, so there is
# nothing to run inside a tmux pane and nothing for acpEngine.js to spawn. Its interactive surface is
# a web app, which makes reaching it from the user's browser this script's whole job.
#
# Three constraints, all measured against dsh 0.1.0-rc.7 rather than assumed:
#
#   1. It binds LOOPBACK and refuses `--host 0.0.0.0` outright (usage error). That is fine: the
#      sandbox server proxies to 127.0.0.1:<port> from inside the same box (src/dshRouter.js).
#   2. Its HTML references assets root-absolutely (/assets/*, /plugins/*), so any prefix-stripping
#      proxy — /_oyren/port/<token>/<port>/, or a route like /dsh — serves an index that then 404s
#      every asset. It needs "/" of SOME origin: the dsh-<label> hostname the orchestrator registers
#      per Codespace (src/dshHost.js derives it from the same env), which the router serves whole.
#      Without that hostname (an older orchestrator) it falls back to the session's catch-all "/".
#   3. Its /api sits behind a browser-trust fence keyed on the request authority: a request is
#      rejected 403 unless its Host was passed as --trusted-host. Both hostnames are passed — the
#      dsh host is where it lives now, the session host is the fallback of constraint 2.
#
# Model choice is dsh's own (Settings → Models, or DEEPSEEK_API_KEY + its default): `dsh web` has no
# --model flag, so AGENT_MODEL is deliberately NOT forwarded — passing it would reach the web app's
# argument parser as an unknown flag and refuse to boot.
#
# Env:
#   OYREN_DSH_PORT   loopback port for the UI (default 3080, dsh's own default)
#   OYREN_DSH_ROUTE  proxy prefix to register (default "none" when the dsh host is derivable, else "/")
#   DEEPSEEK_API_KEY read by dsh itself from the inherited environment — nothing to seed here
# Extra arguments are forwarded to `dsh web` verbatim.
set -u

export PATH="/usr/local/share/pnpm:/app/node_modules/.bin:$PATH"

PORT_DSH="${OYREN_DSH_PORT:-3080}"

command -v dsh >/dev/null 2>&1 || {
  echo "oyren-dsh-web: dsh is not installed in this image (see deploy/sandbox-host/install-agents.sh)" >&2
  exit 127
}

# The public authority ("host" or "host:port") this session is reached at, from whichever env var the
# orchestrator delivered — same precedence as src/publicOrigin.js, minus its SESSION_TOKEN gate: the
# trust fence is about which Host header to accept, not about handing out a capability URL.
public_authority() {
  local raw="${OYREN_PUBLIC_ORIGIN:-}"
  [ -n "$raw" ] || raw="${PUBLIC_URL:-}"
  [ -n "$raw" ] || raw="${SANDBOX_HOSTNAME:-}"
  [ -n "$raw" ] || return 0
  raw="${raw#http://}"
  raw="${raw#https://}"
  printf '%s' "${raw%%/*}"
}

# The dsh hostname, derived exactly as src/dshHost.js does it: "dsh-" + the public host's first
# label, on the same edge domain, lower-cased, port dropped. Empty when there is no origin, no edge
# domain to hang the label off, or the label would overrun DNS's 63 characters — the same cases in
# which the router has no dsh host either.
dsh_host() {
  local host label
  host="$(public_authority)"
  host="$(printf '%s' "${host%%:*}" | tr '[:upper:]' '[:lower:]')"
  case "$host" in .* | *. | *..*) return 0 ;; *.*) ;; *) return 0 ;; esac
  label="dsh-${host%%.*}"
  [ "${#label}" -le 63 ] || return 0
  printf '%s' "$label.${host#*.}"
}

DSH_HOST="$(dsh_host)"
if [ -n "${OYREN_DSH_ROUTE:-}" ]; then PREFIX="$OYREN_DSH_ROUTE"
elif [ -n "$DSH_HOST" ]; then PREFIX=none
else PREFIX=/
fi

# Point the session URL at the UI (fallback only, see constraint 2). Background + retries because
# agent-launch.sh starts this from the tmux session entrypoint.sh pre-creates — i.e. BEFORE
# `exec node /app/src/server.js`, so the control API it talks to may not be listening yet.
register_route() {
  local i
  for i in $(seq 1 30); do
    if oyren route add "$PREFIX" "$PORT_DSH" "DeepSeek Harness" >/dev/null 2>&1; then
      echo "oyren-dsh-web: serving the DeepSeek Harness at $PREFIX (port $PORT_DSH)"
      return 0
    fi
    sleep 2
  done
  echo "oyren-dsh-web: could not register the $PREFIX route — the UI is still up on 127.0.0.1:$PORT_DSH" >&2
}

case "$PREFIX" in
  none | "") ;;
  *) register_route & ;;
esac

args=(--no-open --port "$PORT_DSH")
host="$(public_authority)"
[ -n "$host" ] && args+=(--trusted-host "$host")
[ -n "$DSH_HOST" ] && args+=(--trusted-host "$DSH_HOST")
[ -n "$DSH_HOST" ] && echo "oyren-dsh-web: serving the DeepSeek Harness on https://$DSH_HOST (port $PORT_DSH)"

exec dsh web "${args[@]}" "$@"
