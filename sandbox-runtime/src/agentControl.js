// The session control endpoints the interactive UI drives, all SESSION_TOKEN-gated:
//  - POST /agent/interrupt → engine.interrupt(): a REAL Stop that cancels the running turn without tearing
//    down the session (the old model couldn't stop a turn at all — it deliberately never killed the child).
//  - GET  /agent/models    → the models this subscription/session exposes + the current one (for the picker).
//  - POST /agent/model     → switch the model for subsequent turns ({ "model": "opus" }).
const engine = require("./engineSelect")
const { json, tokenOk, readBody } = require("./agentHttp")
const { maybeHandleSideControl } = require("./sideEngineHttp")

const fail = (res, e) => json(res, 500, { error: String((e && e.message) || e) })

async function handleAgentInterrupt(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" })
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" })
  if (await maybeHandleSideControl(req, res, "interrupt")) return
  try { await engine.interrupt(); return json(res, 200, { ok: true }) } catch (e) { return fail(res, e) }
}

async function handleAgentModels(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "method not allowed" })
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" })
  if (await maybeHandleSideControl(req, res, "models")) return
  try { return json(res, 200, await engine.listModels()) } catch (e) { return fail(res, e) }
}

async function handleAgentModel(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" })
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" })
  let id = null
  try { id = (JSON.parse((await readBody(req)).toString("utf8") || "{}") || {}).model || null } catch {}
  if (!id) return json(res, 400, { error: "missing model" })
  if (await maybeHandleSideControl(req, res, "model", id)) return
  try { await engine.setModel(id); return json(res, 200, { ok: true, current: id }) } catch (e) { return fail(res, e) }
}

module.exports = { handleAgentInterrupt, handleAgentModels, handleAgentModel }
