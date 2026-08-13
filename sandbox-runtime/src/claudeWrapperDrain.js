// Level B survival: when the wrapper disconnects ('s' frame or its socket dying), the child is NOT
// killed — it is DRAINED: allowed to finish the in-flight turn so claude writes it to the on-disk
// session transcript, then shut down via stdin EOF (the path a stream-json claude exits 0 on). A
// reopened panel's `--resume` then restores the full conversation from disk.
//
// Accepted v1 limits (deliberate, documented): a broker restart EPIPEs draining children (nobody
// re-adopts their pipes), and a permission prompt addressed to a dead panel can never be answered —
// both are bounded by the deadlines below instead of being fixed.
const DEFAULT_DRAIN_MS = Number(process.env.OYREN_CLAUDE_DRAIN_MS) || 600000
const STDIN_TO_TERM_MS = 15000
const TERM_TO_KILL_MS = 5000

/** Drive one disconnected child to a clean exit. Timeline: idle -> close stdin NOW; busy -> close
 *  stdin on the next result line, or at `drainMs` if none ever comes; then +15s SIGTERM and +5s
 *  SIGKILL for a child that ignores EOF. Every timer is unref'd — a draining child must never be
 *  what keeps the broker process alive. Calls onDone(exitInfo) exactly once. */
function startDrain({
  child, turnState, drainMs = DEFAULT_DRAIN_MS, onDone = () => {},
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout,
} = {}) {
  const timers = []
  let done = false

  const after = (ms, fn) => {
    const t = setTimeoutImpl(fn, ms)
    if (t && typeof t.unref === "function") t.unref()
    timers.push(t)
  }

  child.onExit((exit) => {
    if (done) return
    done = true
    for (const t of timers) clearTimeoutImpl(t)
    onDone(exit)
  })

  const closeNow = () => {
    child.closeStdin()
    after(STDIN_TO_TERM_MS, () => {
      child.term()
      after(TERM_TO_KILL_MS, () => child.kill())
    })
  }

  if (!turnState.isBusy()) {
    closeNow()
    return
  }
  let closed = false
  const closeOnce = () => {
    if (closed || done) return
    closed = true
    closeNow()
  }
  turnState.onceResult(closeOnce) // the turn finished — flush achieved, wind the child down
  after(drainMs, closeOnce) // the turn never finished — stop waiting, EOF anyway
}

module.exports = { startDrain, DEFAULT_DRAIN_MS, STDIN_TO_TERM_MS, TERM_TO_KILL_MS }
