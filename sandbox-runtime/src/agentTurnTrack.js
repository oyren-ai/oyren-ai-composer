// Backward-compat shim for the LOOP engine (server-side sendAgentTask/reconcile), which still speaks the
// old turn_id contract: it sends a message tagged with a client-minted turn_id, may later ask
// GET /agent/current for {turnId,done}, and can re-POST the SAME id with empty text to REPLAY that turn's
// completed output (never re-run). The interactive browser UI no longer uses any of this — it reads the
// persistent /agent/stream — so we only track a turn when an id is actually supplied (loop path). We keep a
// single slot: one container = one user, and only the current/last id-tagged turn is ever replayed.
let current = null // { id, lines, done } — null until the first id-tagged turn

/** Start tracking an id-tagged turn (no-op for interactive sends, which pass no id). */
function beginTurn(id) { if (id) current = { id, lines: [], done: false } }

/** Mirror one recorded ndjson line into the active turn; a `result` line closes it. */
function recordLine(line, isResult) {
  if (!current || current.done) return
  current.lines.push(line)
  if (isResult) current.done = true
}

/** Return the buffered lines for `id` (running or done) so a reconcile can replay them; null if it's not
 *  the tracked turn (a newer turn replaced it → unrecoverable). */
function replay(id) { return current && current.id === id ? current.lines.slice() : null }

/** The {turnId,done} half of the session state GET /agent/current reports (null before any id-tagged turn). */
function turnState() { return { turnId: current ? current.id : null, done: current ? current.done : null } }

module.exports = { beginTurn, recordLine, replay, turnState }
