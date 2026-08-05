// The `?agent=<kind>` leg of the /agent/* endpoints: when a request names a kind other than the
// session's launch agent, it is served by a SECONDARY engine (sideEngines.js) and the primary path
// is never touched. Each helper returns true when it handled the request, so the existing handlers
// stay one added line each. Side turns always stream inline (the follow shape) — they belong to
// exactly one caller and never ride the broadcast, so there is no fire-and-forget variant.
const side = require("./sideEngines")
const { json } = require("./agentHttp")
const { startKeepalive } = require("./agentKeepalive")

function requestedKind(reqUrl) {
  const kind = new URL(reqUrl, "http://localhost").searchParams.get("agent")
  return kind && kind !== (process.env.AGENT_KIND || "") ? kind : null
}

const rejectKind = (res, kind) =>
  json(res, 400, { error: `no side engine for "${kind}" — claude-code runs only as the launch agent, and the launch agent needs no ?agent=` })

const isResultLine = (line) => { try { return JSON.parse(line).type === "result" } catch { return false } }

/** POST /agent/message?agent=<kind>: run one turn on the side engine, ndjson streamed until its
 *  `result` line. Returns false when the request is for the primary engine. */
function maybeHandleSideMessage(req, res, payload) {
  const kind = requestedKind(req.url)
  if (!kind) return false
  if (!side.isSideKind(kind)) { rejectKind(res, kind); return true }
  const head = () => { if (!res.headersSent) res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" }) }
  const stopKeepalive = startKeepalive(res, head)
  let ended = false
  const finish = () => { if (!ended) { ended = true; stopKeepalive(); try { res.end() } catch {} } }
  const sink = (line) => {
    head()
    try { res.write(line + "\n") } catch {}
    if (isResultLine(line)) finish()
  }
  res.on("close", () => { ended = true; stopKeepalive() })
  side.send(kind, payload, sink).catch((e) => { sink(JSON.stringify({ type: "result", is_error: true, error: String((e && e.message) || e) })) })
  return true
}

/** The control endpoints' side leg. `op` ∈ interrupt | models | model. Returns true when handled. */
async function maybeHandleSideControl(req, res, op, arg) {
  const kind = requestedKind(req.url)
  if (!kind) return false
  if (!side.isSideKind(kind)) { rejectKind(res, kind); return true }
  try {
    if (op === "interrupt") { await side.interrupt(kind); json(res, 200, { ok: true }) }
    else if (op === "models") json(res, 200, await side.listModels(kind))
    else if (op === "model") { await side.setModel(kind, arg); json(res, 200, { ok: true, current: arg }) }
    else json(res, 500, { error: `unknown side op "${op}"` })
  } catch (e) {
    json(res, 500, { error: String((e && e.message) || e) })
  }
  return true
}

module.exports = { maybeHandleSideMessage, maybeHandleSideControl }
