// POST /agent/message?token=<SESSION_TOKEN> — inject one user turn into the persistent session (agentEngine).
// Two modes:
//  - default (interactive): push the message and return 202 immediately; the agent's output streams on the
//    separate persistent GET /agent/stream. This is what lets the UI send a message mid-turn to steer.
//  - ?follow=1 (loops / legacy sendAgentTask / curl): stream this session's ndjson back inline until the
//    next `result` line, then close — the same one-request-one-turn shape those callers still expect.
// GET /agent/current?token= reports the live session state (busy/model) for the UI's status + reconnect.
const crypto = require("crypto")
const engine = require("./engineSelect")
const broadcast = require("./agentBroadcast")
const { startKeepalive } = require("./agentKeepalive")
const { json, tokenOk, readBody } = require("./agentHttp")

// Body is one stream-json `user` line (frontend encodeUserMessage) or a raw prompt string. Prefer the full
// content-block array (carries image blocks) so vision works natively; fall back to joined text.
function extractMessage(body) {
  const s = body.toString("utf8").trim()
  if (!s) return { payload: null, turnId: null, clientMsgId: null }
  try {
    const j = JSON.parse(s)
    const turnId = j && typeof j.turn_id === "string" && j.turn_id ? j.turn_id : null
    const clientMsgId = j && typeof j.client_msg_id === "string" && j.client_msg_id ? j.client_msg_id : null
    const displayText = j && typeof j.display_text === "string" && j.display_text ? j.display_text : null
    const content = j && j.message && j.message.content
    if (Array.isArray(content)) {
      // "effectively empty" = only blank text blocks (a reconcile re-POST sends [{text:""}]); any image
      // block or non-blank text is real content. Empty ⇒ null so the turn_id routes to a replay, not a send.
      const meaningful = content.some((b) => b && (b.type === "text" ? String(b.text || "").trim() : true))
      return { payload: meaningful ? content : null, turnId, clientMsgId, displayText }
    }
    if (typeof j === "string" && j.trim()) return { payload: j.trim(), turnId, clientMsgId, displayText }
    return { payload: null, turnId, clientMsgId, displayText }
  } catch {
    return { payload: s, turnId: null, clientMsgId: null, displayText: null } // not JSON → raw prompt
  }
}

// Echo the user's turn into the broadcast buffer so it reaches the durable event log — the SDK only emits
// agent output, so without this a replaying client can rebuild everything EXCEPT what the user typed. The
// id lets the live UI dedupe this echo against its own optimistic bubble; display_text (when sent) replaces
// the wire text so a replayed bubble shows what the user TYPED, not the machine context preamble around it.
function echoUserMessage(payload, clientMsgId, displayText) {
  const blocks = Array.isArray(payload) ? payload : [{ type: "text", text: payload }]
  const content = displayText
    ? [...blocks.filter((b) => b && b.type !== "text"), { type: "text", text: displayText }]
    : blocks
  broadcast.record(JSON.stringify({ type: "user_message", id: clientMsgId || crypto.randomUUID(), message: { content } }))
}

const wantsFollow = (reqUrl) => new URL(reqUrl, "http://localhost").searchParams.get("follow") === "1"
const isResultLine = (line) => { try { return JSON.parse(line).type === "result" } catch { return false } }

const ndjsonHead = (res) => { if (!res.headersSent) res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" }) }

// ?follow=1: tail live output (no snapshot replay) until this turn's `result`, then close. Subscribe BEFORE
// send so no line is missed; a dropped connection just unsubscribes (the turn keeps running in the session).
function follow(res, payload, turnId) {
  const head = () => ndjsonHead(res)
  const stopKeepalive = startKeepalive(res, head)
  const done = () => { stopKeepalive(); try { res.end() } catch {} }
  const unsubscribe = broadcast.subscribe({ onLine: (line) => {
    head(); try { res.write(line + "\n") } catch {}
    if (isResultLine(line)) { unsubscribe(); done() }
  } })
  res.on("close", () => { if (!res.writableEnded) { unsubscribe(); stopKeepalive() } })
  engine.send(payload, turnId).catch((e) => { head(); try { res.write(JSON.stringify({ type: "result", is_error: true, error: String(e && e.message || e) }) + "\n") } catch {}; unsubscribe(); done() })
}

// Loop reconcile: an empty message carrying a known turn_id replays that turn's buffered lines (never
// re-runs). Unknown/expired id → 409 (a newer turn replaced it); the caller leaves its placeholder.
function replay(res, turnId) {
  const lines = engine.replayTurn(turnId)
  if (!lines) return json(res, 409, { error: "the agent is answering a different message" })
  ndjsonHead(res)
  try { if (lines.length) res.write(lines.join("\n") + "\n"); res.end() } catch {}
}

async function handleAgentMessage(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" })
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" })
  const { payload, turnId, clientMsgId, displayText } = extractMessage(await readBody(req))
  if (!payload) return turnId ? replay(res, turnId) : json(res, 400, { error: "empty or unparseable message" })
  echoUserMessage(payload, clientMsgId, displayText)
  if (wantsFollow(req.url)) return follow(res, payload, turnId)
  try { await engine.send(payload, turnId); return json(res, 202, { ok: true }) } // fire-and-forget; output on /agent/stream
  catch (e) { return json(res, 500, { error: `failed to start the agent: ${String(e && e.message || e)}` }) }
}

function handleAgentCurrent(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "method not allowed" })
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" })
  // bootId is additive: a caller that remembers it can detect a container replacement (fresh boot).
  return json(res, 200, { bootId: broadcast.BOOT_ID, ...engine.state() })
}

module.exports = { handleAgentMessage, handleAgentCurrent, extractMessage }
