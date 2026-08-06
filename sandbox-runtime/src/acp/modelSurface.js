// The ACP engine's model surface (list + switch), extracted from acpEngine.js. `ctx` hands over the
// engine's live session state via getters so a respawned child is always the one addressed.
const { resolveModels } = require("./models")

/** ctx: { agentKind(), ensureStarted(), rpc(), sessionId(), sessionModels(), getModel(), rememberModel(id) }.
 *  agentKind is the ENGINE'S OWN kind, not AGENT_KIND: a side engine falling back to the launch
 *  agent's static list would offer another agent's models. */
function makeModelSurface(ctx) {
  async function listModels() {
    try { await ctx.ensureStarted() } catch { /* fall through to the static list — /agent/models must never 500 */ }
    return { models: resolveModels(ctx.agentKind() || "", ctx.sessionModels()), current: ctx.getModel() }
  }
  async function setModel(id) {
    await ctx.ensureStarted()
    try { await ctx.rpc().request("session/set_model", { sessionId: ctx.sessionId(), modelId: id }) }
    catch (e) { console.error(`[acp] session/set_model unsupported/failed (${String(e && e.message || e)}) — remembering the choice best-effort`) }
    ctx.rememberModel(id || null)
  }
  return { listModels, setModel }
}

module.exports = { makeModelSurface }
