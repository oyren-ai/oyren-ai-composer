// Invariant agent metadata, container side (Phase 1b): the orchestrator stores an opaque blob
// {repos:[{dir, branch, prUrl, checkpointRef}], turnCount, updatedAt} per session behind
// POST /sandbox/agent-meta (same appSlug+controlToken auth as /sandbox/git-token). This module owns
// the READ side plus the per-boot turn counter: fetchMeta() asks the orchestrator for the stored
// blob ({appSlug, controlToken} body, NO meta key = fetch form; 8s timeout; any failure falls back
// to decoding the AGENT_META_B64 env the orchestrator injects on relaunch), and the engines bump
// localTurnCount() once per user turn. agentRecovery gates its preamble on the stored meta;
// agentMetaReport.js is the WRITE side. All failures resolve to null — meta must never break a turn.
const FETCH_TIMEOUT_MS = 8000

let localTurns = 0
let stored // cached single-flight loadStoredMeta() promise — the blob is fetched once per boot

function metaFromEnv(env) {
  try {
    const meta = JSON.parse(Buffer.from(env.AGENT_META_B64 || "", "base64").toString("utf8"))
    return meta && typeof meta === "object" ? meta : null
  } catch { return null }
}

/** The stored meta blob, or null: orchestrator first, AGENT_META_B64 when the fetch fails. */
async function fetchMeta({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const { ORCHESTRATOR_URL, OYREN_SESSION_SLUG, CONTROL_TOKEN } = env
  if (!ORCHESTRATOR_URL || !OYREN_SESSION_SLUG || !CONTROL_TOKEN || !fetchImpl) return metaFromEnv(env)
  try {
    const res = await fetchImpl(`${ORCHESTRATOR_URL}/sandbox/agent-meta`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appSlug: OYREN_SESSION_SLUG, controlToken: CONTROL_TOKEN }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return metaFromEnv(env)
    const body = await res.json()
    return (body && typeof body.meta === "object" && body.meta) || null // a genuine "nothing stored" answer is authoritative
  } catch { return metaFromEnv(env) }
}

/** fetchMeta, cached for the whole boot (recovery gating + the report baseline share one fetch). */
function loadStoredMeta(opts) {
  if (!stored) stored = fetchMeta(opts).catch(() => null)
  return stored
}

/** Engines call this once per user turn; collectMeta adds it on top of the stored baseline. */
function bumpTurnCount() { localTurns++ }
const localTurnCount = () => localTurns

// Test seam: clear the cached blob + turn counter between cases.
function __reset() { stored = undefined; localTurns = 0 }

module.exports = { fetchMeta, loadStoredMeta, bumpTurnCount, localTurnCount, __reset }
