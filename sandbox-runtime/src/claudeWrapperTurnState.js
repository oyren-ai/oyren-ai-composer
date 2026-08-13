// Minimal protocol awareness: ONE NDJSON line-scanner, used only to decide when a disconnected
// child's turn is over (claudeWrapperDrain.js) and which session id a draining child owns (the
// registry's resume-race hold). It never transforms or filters the byte stream — the relay stays
// byte-exact regardless of what this sees.
//   stdin  {"type":"user"}                                   -> a turn started (busy)
//   stdout {"type":"system","subtype":"init","session_id"}   -> remember the session id
//   stdout {"type":"result"}                                 -> the turn finished (idle)
const MAX_LINE_BYTES = 1024 * 1024 // a pathological unterminated line must not grow unboundedly

function createLineScanner(onLine) {
  let buf = ""
  let discarding = false // mid-oversized-line: drop until the next newline
  return (chunk) => {
    buf += chunk.toString("utf8")
    let nl
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!discarding && line) onLine(line)
      discarding = false
    }
    if (buf.length > MAX_LINE_BYTES) { buf = ""; discarding = true }
  }
}

function createTurnState() {
  let sessionId = null
  let busy = false
  let resultListeners = []
  const parse = (line) => { try { return JSON.parse(line) } catch { return null } }

  const feedStdin = createLineScanner((line) => {
    const msg = parse(line)
    if (msg && msg.type === "user") busy = true // control_request etc never mark a turn open
  })
  const feedStdout = createLineScanner((line) => {
    const msg = parse(line)
    if (!msg) return
    if (msg.type === "system" && msg.subtype === "init" && typeof msg.session_id === "string") {
      sessionId = msg.session_id
    }
    if (msg.type === "result") {
      busy = false
      const listeners = resultListeners
      resultListeners = []
      for (const cb of listeners) { try { cb() } catch { /* listener's problem */ } }
    }
  })

  return {
    feedStdin,
    feedStdout,
    isBusy: () => busy,
    getSessionId: () => sessionId,
    /** One-shot: fires on the NEXT result line only. */
    onceResult: (cb) => resultListeners.push(cb),
  }
}

module.exports = { createTurnState }
