#!/usr/bin/env bash
# SOURCE this file. DeepSeek Harness 0.1.5-rc.1 adds authority-bound browser sessions on top of its
# Host/Origin fence, while its client Settings plane still chooses memory-only persistence for a
# non-loopback page. The Oyren router already token-gates the dedicated dsh hostname before proxying
# to this loopback-only server, so a second process-token exchange would make the authenticated public
# page unusable. Patch the Host to keep the declared trusted-host fence as the reachability boundary,
# accept that authenticated proxy as the identity boundary, and keep Settings/Models persistence on
# the Host. Every replacement must match exactly once (or already be present) so an upstream layout
# change fails the bake instead of silently weakening access or shipping an unusable Settings page.

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
  local port=3199 log body pid ok="" denied
  echo "==> dsh settings-trust boot smoke"
  log="$(mktemp)"
  body="$(mktemp)"
  HOME=/root dsh --profile web --no-open --port "$port" --trusted-host bake-check.local >"$log" 2>&1 &
  pid=$!
  for _ in $(seq 1 90); do
    if curl -fsS -m 5 -X POST "http://127.0.0.1:${port}/api/settings.describe" \
      -H 'Host: bake-check.local' -H 'content-type: application/json' \
      -d '{"type":"client-request","rpcId":"rpc-bake-1","method":"settings.describe","payload":{}}' \
      >"$body" 2>/dev/null \
      && grep -q '"server-response"' "$body" \
      && ! grep -q 'forbidden' "$body"; then
      ok=1
      break
    fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if [ -n "$ok" ]; then
    denied="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${port}/api/settings.describe" \
      -H 'Host: not-declared.local' -H 'content-type: application/json' \
      -d '{"type":"client-request","rpcId":"rpc-bake-2","method":"settings.describe","payload":{}}' 2>/dev/null || true)"
  fi
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  if [ -n "$ok" ] && [ "$denied" = 403 ]; then
    echo "    settings.describe answers over a trusted host; an undeclared host stays forbidden"
    rm -f "$log" "$body"
    return 0
  fi
  echo "ERROR: dsh settings-trust boot smoke failed (see $log)" >&2
  cat "$log" >&2
  rm -f "$body"
  return 1
}
