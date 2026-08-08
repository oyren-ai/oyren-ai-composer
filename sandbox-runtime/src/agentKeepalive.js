// Keeps the HTTP /agent/message stream warm for the WHOLE turn, so a DigitalOcean gateway idle-timeout
// can't kill a turn during a long silent stretch (subagents, builds, big thinks — not just startup).
// On each tick it commits the ndjson headers (via `head`, so bytes actually flow) then writes an
// ignorable `{"type":"ping"}` line — the oyren-ai client folds unknown event types to a no-op
// (parseStreamJsonLine + reducer default), so pings never pollute the transcript but DO reset the
// client's liveness timer. Safe mid-turn because the broadcast forwards complete ndjson lines only.
const KEEPALIVE_MS = 15_000

/** Start the keepalive; returns a `stop()` that clears the timer (idempotent). `onFail` (optional) is
 *  invoked once when a ping write throws — a dead/half-open socket — so the caller can reap the reader
 *  instead of pinging a corpse every 15s forever. */
function startKeepalive(res, head, intervalMs = KEEPALIVE_MS, onFail) {
  const timer = setInterval(() => {
    if (res.writableEnded) return
    try { head(); res.write('{"type":"ping"}\n') }
    catch { clearInterval(timer); if (onFail) onFail() /* socket gone → stop pinging AND reap */ }
  }, intervalMs)
  if (timer.unref) timer.unref() // never keep the process alive just for the keepalive
  return () => clearInterval(timer)
}

module.exports = { startKeepalive, KEEPALIVE_MS }
