// Shared by the systemd launchers (start-sandbox.mjs, start-editor.mjs, start-tmux.mjs, start-zed.mjs).
//
// The orchestrator delivers a session's environment as CONTAINER_ENV_B64 — base64 of a JSON object
// — inside cloud-init's /etc/oyren/sandbox.env. It stays base64 rather than becoming plain
// KEY=value lines because the values are not safe for that format: AGENT_META_B64 is JSON, the
// launch task is free text that can contain newlines, and callers may pass arbitrary env through.
// systemd's EnvironmentFile has no multi-line escape, so flattening would silently truncate them.
//
// Decoding here and exec'ing with a merged env keeps every value byte-exact and keeps the secrets
// out of the process table (they are never argv).

/** Decode CONTAINER_ENV_B64 into a plain object. Returns {} when unset. */
export function sessionEnv() {
  const b64 = process.env.CONTAINER_ENV_B64 ?? ''
  if (!b64) return {}
  const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CONTAINER_ENV_B64 must decode to a JSON object')
  }
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
}

/** process.env merged with the session env, minus the blob itself — nothing downstream needs a
 *  second copy of every secret. */
export function mergedEnv() {
  const env = { ...process.env, ...sessionEnv() }
  delete env.CONTAINER_ENV_B64
  return env
}

/** The Node heap default entrypoint.sh gives agent and build commands, so heavy Node-based test
 *  and build runs don't OOM-kill the whole machine: --max-old-space-size from OYREN_NODE_HEAP_MB
 *  (default 4096) unless NODE_OPTIONS already names one. Pure: returns a new env. */
export function withNodeHeap(env) {
  const current = env.NODE_OPTIONS ?? ''
  if (/(^|\s)--max-old-space-size=/.test(current)) return { ...env }
  const heap = `--max-old-space-size=${env.OYREN_NODE_HEAP_MB ?? '4096'}`
  return { ...env, NODE_OPTIONS: current ? `${heap} ${current}` : heap }
}
