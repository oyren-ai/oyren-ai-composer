// The ACP engine's model surface (list + switch), extracted from acpEngine.js. `ctx` hands over the
// engine's live session state via getters so a respawned child is always the one addressed.
const { resolveModels } = require("./models")

/** ctx: { ensureStarted(), rpc(), sessionId(), sessionModels(), getModel(), rememberModel(id) } */
function makeModelSurface(ctx) {
  async function listModels() {
    try { await ctx.ensureStarted() } catch { /* fall through to the static list — /agent/models must never 500 */ }
    return { models: resolveModels(process.env.AGENT_KIND || "", ctx.sessionModels()), current: ctx.getModel() }
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
