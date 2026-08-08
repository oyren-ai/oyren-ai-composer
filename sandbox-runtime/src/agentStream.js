// GET /agent/stream?token=<SESSION_TOKEN> — the persistent read side of the interactive chat. One of these
// stays open per browser tab for the container's life: it replays the recent buffer (typically the in-flight
// turn) then tails every subsequent session message live. Decoupling reads from writes is what makes the new
// UX possible — POST /agent/message can inject a steer mid-turn while THIS stream keeps delivering output,
// and a dropped connection simply reconnects and replays (no turn_id bookkeeping needed anymore).
//
// Cursor-aware mode (`?mode=indexed&after=<n>`, used by the orchestrator's pull pump): first line is a
// `{"type":"hello","boot":<BOOT_ID>,"last":<n>}` frame, then every line ships as `{"n":<idx>,"line":<raw>}`
// and replay starts strictly AFTER the given cursor — so a reconnecting pump never re-reads the whole
// buffer. No `mode` param = the legacy raw-line behavior, byte-for-byte unchanged.
const broadcast = require("./agentBroadcast")
const { startKeepalive } = require("./agentKeepalive")
const { tokenOk, json } = require("./agentHttp")

function streamQuery(reqUrl) {
  const params = new URL(reqUrl, "http://localhost").searchParams
  const after = Number(params.get("after"))
  return { indexed: params.get("mode") === "indexed", after: Number.isFinite(after) && after > 0 ? Math.floor(after) : 0 }
}

function handleAgentStream(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "method not allowed" })
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" })
  const { indexed, after } = streamQuery(req.url)

  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" })

  let unsubscribe = () => {}
  let stopKeepalive = () => {}
  let cleanedUp = false
  // Reap this reader the instant its socket is known dead — via the OS `close` event OR a failed write.
  // Relying on `close` alone leaked subscribers on half-open (wall-severed) sockets: the engine kept
  // fanning every line + a keepalive timer at a dead socket, piling up CPU until Modal throttled the box.
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    unsubscribe()
    stopKeepalive()
    try { res.destroy() } catch { /* already gone */ }
  }
  const write = (raw) => { try { res.write(raw + "\n") } catch { cleanup() } }
  const frame = indexed ? (line, n) => JSON.stringify({ n, line }) : (line) => line

  // Snapshot BEFORE subscribing: record() fans out AFTER appending on the same tick, so a line can't slip
  // between the snapshot and the subscription (no gap) and can't be in both (no dupe).
  const head = () => {} // headers already committed above
  stopKeepalive = startKeepalive(res, head, undefined, cleanup) // idle-timeout defeat + reap on ping failure
  if (indexed) {
    const replay = broadcast.snapshotAfter(after)
    write(JSON.stringify({ type: "hello", boot: broadcast.BOOT_ID, last: broadcast.lastIndex() }))
    unsubscribe = broadcast.subscribe({ onLine: (line, n) => write(frame(line, n)) })
    for (const entry of replay) write(frame(entry.line, entry.n))
  } else {
    const replay = broadcast.snapshot()
    unsubscribe = broadcast.subscribe({ onLine: (line, n) => write(frame(line, n)) })
    for (const line of replay) write(line)
  }

  res.on("close", cleanup)
}

module.exports = { handleAgentStream }
