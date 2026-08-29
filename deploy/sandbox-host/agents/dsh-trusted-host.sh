#!/usr/bin/env bash
# SOURCE this file. DeepSeek Harness keeps its settings/credential API plane loopback-only even on a
# --trusted-host deployment (PRIVILEGED_METHODS in dsh-client-connection re-checks the browser-trust
# fence with an empty trust list, so settings.describe/update, credentials.*, llm.discoverModels etc.
# 403 for every non-loopback Host), and its client settings UI mirrors that with a loopback-only
# persistence mode. The sandbox serves the UI at the public dsh-<label> hostname, so untouched,
# Settings -> Models fails with "settings are unavailable in this browser". Until upstream grows a
# flag for this, patch the three exact spots after install; every replacement must match exactly once
# or the bake fails loudly — a silent miss would ship a broken Settings page with no error at build
# time.

# patch_dsh_trusted_host <install-dir> — rewrite the fence, then gate on the result parsing.
patch_dsh_trusted_host() {
  local dir="$1" here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  echo "==> dsh settings plane: allow the declared trusted hosts"
  node "$here/dsh-trusted-host.mjs" "$dir/node_modules/.pnpm" \
    || { echo "ERROR: dsh settings-trust patch failed" >&2; return 1; }
  # Parse-level gate on exactly the three patched files; the boot smoke is the behavior-level gate.
  find "$dir/node_modules/.pnpm" -maxdepth 6 -type f \( \
    -path '*/@deepseek-ai+dsh-client-connection@*/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js' -o \
    -path '*/@deepseek-ai+dsh-client-ui-settings@*/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js' -o \
    -path '*/@deepseek-ai+dsh-client-ui-settings-general@*/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js' \) \
    -print0 | xargs -0 -r -n1 node --check \
    || { echo "ERROR: a patched dsh file failed node --check" >&2; return 1; }
}

# dsh_settings_trust_smoke — boot the patched server once and prove the settings plane answers for a
# declared trusted authority, the exact fence the sandbox router relies on (it forwards Host
# verbatim). The behavior-level counterpart of the exact-match patch gate above. Needs `dsh` on PATH.
dsh_settings_trust_smoke() {
  local port=3199 log pid ok=""
  echo "==> dsh settings-trust boot smoke"
  log="$(mktemp)"
  HOME=/root dsh --profile web --no-open --port "$port" --trusted-host bake-check.local >"$log" 2>&1 &
  pid=$!
  for _ in $(seq 1 90); do
    if curl -fsS -m 5 -X POST "http://127.0.0.1:${port}/api/settings.describe" \
      -H 'Host: bake-check.local' -H 'content-type: application/json' \
      -d '{"type":"client-request","rpcId":"rpc-bake-1","method":"settings.describe","payload":{}}' \
      >/tmp/dsh-settings-smoke-body 2>/dev/null \
      && grep -q '"server-response"' /tmp/dsh-settings-smoke-body \
      && ! grep -q 'forbidden' /tmp/dsh-settings-smoke-body; then
      ok=1
      break
    fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  if [ -n "$ok" ]; then
    echo "    settings.describe answers over a trusted host"
    rm -f "$log"
    return 0
  fi
  echo "ERROR: dsh settings-trust boot smoke failed (see $log)" >&2
  cat "$log" >&2
  return 1
}
