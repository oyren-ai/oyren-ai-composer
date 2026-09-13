// POST /agent/reset — the Chat v2 conversation-reset primitive (OYR-0063 T1). One call ends the
// current conversation everywhere and marks the boundary in the durable event log:
//   1. the selected launch engine (SDK or ACP, per engineSelect) is interrupted, torn down, and its
//      persisted resume/session id cleared — the next send starts a genuinely fresh conversation;
//   2. every live side engine is dropped (they persist nothing, so dropping is their whole reset);
//   3. a {"type":"conversation_reset","at":…} marker is recorded onto the broadcast ring — the ring
//      itself is deliberately KEPT (no broadcast.reset()): the durable log must carry the boundary
//      so clients can segment history, not lose the history that came before it. Verified against
//      the orchestrator pull pump: its translator stores unknown types verbatim as "system" events.
// Idempotent and safe when idle; SESSION_TOKEN gated like every /agent/* edge.
const engine = require("./engineSelect")
const sideEngines = require("./sideEngines")
const broadcast = require("./agentBroadcast")
const { json, tokenOk } = require("./agentHttp")

async function handleAgentReset(req, res) {
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" })
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" })
  try {
    await engine.reset()
    sideEngines.resetAll()
    const at = Date.now()
    broadcast.record(JSON.stringify({ type: "conversation_reset", at }))
    json(res, 200, { ok: true, at })
  } catch (err) {
    json(res, 500, { error: String((err && err.message) || err) })
  }
}

module.exports = { handleAgentReset }
