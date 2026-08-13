const { test } = require("node:test")
const assert = require("node:assert")
const { startDrain, STDIN_TO_TERM_MS, TERM_TO_KILL_MS } = require("./claudeWrapperDrain")
const { fakeClock, fakeChild } = require("../test/helpers/fakes")

function makeTurnState(busy) {
  let cbs = []
  return {
    isBusy: () => busy,
    onceResult: (cb) => cbs.push(cb),
    fireResult: () => { busy = false; cbs.splice(0).forEach((cb) => cb()) },
  }
}

function drain({ busy, drainMs = 1000 }) {
  const clock = fakeClock()
  const child = fakeChild()
  const turnState = makeTurnState(busy)
  const doneWith = []
  startDrain({
    child, turnState, drainMs, onDone: (exit) => doneWith.push(exit),
    setTimeoutImpl: clock.set, clearTimeoutImpl: clock.clear,
  })
  return { clock, child, turnState, doneWith }
}

test("idle child: stdin closes immediately, then TERM at +15s and KILL +5s later if it lingers", () => {
  const { clock, child } = drain({ busy: false })
  assert.equal(child.stdinClosed, true, "idle means nothing to wait for — EOF now")
  assert.equal(child.termed, false)
  clock.advance(STDIN_TO_TERM_MS)
  assert.equal(child.termed, true, "a child that ignores EOF gets SIGTERM")
  assert.equal(child.killed, false)
  clock.advance(TERM_TO_KILL_MS)
  assert.equal(child.killed, true, "and SIGKILL as the final backstop")
})

test("a clean exit cancels every escalation timer and reports onDone exactly once", () => {
  const { clock, child, doneWith } = drain({ busy: false })
  clock.advance(1000)
  child.emitExit({ code: 0, signal: null })
  assert.deepEqual(doneWith, [{ code: 0, signal: null }])
  clock.advance(STDIN_TO_TERM_MS + TERM_TO_KILL_MS)
  assert.equal(child.termed, false, "no TERM after a clean exit")
  assert.equal(child.killed, false)
  assert.equal(clock.pending(), 0, "no timers may outlive the drain")
})

test("busy child: stdin stays open until the result line lands, then closes", () => {
  const { child, turnState } = drain({ busy: true })
  assert.equal(child.stdinClosed, false, "mid-turn — the child still needs stdin")
  turnState.fireResult()
  assert.equal(child.stdinClosed, true, "turn done, transcript flushed — now EOF")
})

test("busy child with a turn that never finishes: the drain deadline closes stdin anyway", () => {
  const { clock, child } = drain({ busy: true, drainMs: 600000 })
  clock.advance(599999)
  assert.equal(child.stdinClosed, false)
  clock.advance(1)
  assert.equal(child.stdinClosed, true, "OYREN_CLAUDE_DRAIN_MS bounds how long we wait for a result")
  clock.advance(STDIN_TO_TERM_MS)
  assert.equal(child.termed, true)
})

test("result then deadline does not double-close or re-escalate", () => {
  const { clock, child, turnState } = drain({ busy: true, drainMs: 1000 })
  turnState.fireResult()
  const pendingAfterResult = clock.pending()
  clock.advance(1000) // the deadline fires into the closed guard
  assert.equal(clock.pending(), pendingAfterResult - 1, "the deadline slot expires without scheduling anything new")
  assert.equal(child.stdinClosed, true)
})
