// The session control endpoints the interactive UI drives, all SESSION_TOKEN-gated:
//  - POST /agent/interrupt → engine.interrupt(): a REAL Stop that cancels the running turn without tearing
//    down the session (the old model couldn't stop a turn at all — it deliberately never killed the child).
//  - GET  /agent/models    → the models this subscription/session exposes + the current one (for the picker).
//  - POST /agent/model     → switch the model for subsequent turns ({ "model": "opus" }).
//  - GET  /agent/auth      → per-provider credential status, so the UI can show "log in via the
//    terminal" BEFORE a user wastes a turn on an unauthenticated engine (Chat v2 T2).
const engine = require("./engineSelect")
const { json, tokenOk, readBody } = require("./agentHttp")
const { maybeHandleSideControl } = require("./sideEngineHttp")
const { hasCredential } = require("./agentAuthProbe")
const { sideEnvForKind } = require("./sideAgentAuth")
const { TABLE } = require("./acp/spawnConfig")

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

// Pure file/env inspection, no process spawn, no network — the same fail-soft philosophy as the
// boot probe: hasCredential is true/false when the kind has a credential contract, null (unknown)
// when it doesn't. Side kinds are evaluated against sideEnvForKind(kind) so the AGENT_SIDE_AUTH_B64
// overlay counts even before that kind's files are lazily seeded.
function handleAgentAuth(req, res, { env = process.env } = {}) {
  if (req.method !== "GET") return json(res, 405, { error: "method not allowed" })
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" })
  const launchKind = env.AGENT_KIND || "claude-code"
  const record = (kind, kindEnv, launch) => ({ kind, hasCredential: hasCredential({ env: kindEnv, agentKind: kind }), launch })
  const sides = Object.keys(TABLE).filter((k) => k !== launchKind)
  return json(res, 200, {
    agents: [record(launchKind, env, true), ...sides.map((k) => record(k, sideEnvForKind(k, env), false))],
  })
}

module.exports = { handleAgentInterrupt, handleAgentModels, handleAgentModel, handleAgentAuth }
