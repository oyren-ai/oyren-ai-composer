// Deterministic doubles for the drain/registry unit tests: a manual clock (no real waiting) and a
// child handle with the same surface claudeWrapperChild.createChild returns.
function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map() // id -> { at, fn }
  return {
    set: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id },
    clear: (id) => { timers.delete(id) },
    pending: () => timers.size,
    /** Advance the clock, firing due timers in time order (including ones scheduled by callbacks). */
    advance(ms) {
      now += ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)
        if (due.length === 0) return
        for (const [id, t] of due) { timers.delete(id); t.fn() }
      }
    },
  }
}

function fakeChild() {
  const h = {
    writes: [],
    observers: [],
    exitCbs: [],
    sink: null,
    stdinClosed: false,
    termed: false,
    killed: false,
    exited: null,
    observe: (cb) => h.observers.push(cb),
    attachSink: (s) => { h.sink = s },
    detachSink: () => { h.sink = null },
    write: (b) => h.writes.push(Buffer.from(b)),
    closeStdin: () => { h.stdinClosed = true },
    term: () => { h.termed = true },
    kill: () => { h.killed = true },
    onExit: (cb) => { if (h.exited) cb(h.exited); else h.exitCbs.push(cb) },
    hasExited: () => h.exited !== null,
    exitInfo: () => h.exited,
    // test drivers
    emitStdout: (s) => h.observers.forEach((cb) => cb("stdout", Buffer.from(s))),
    emitExit: (info = { code: 0, signal: null }) => {
      h.exited = info
      if (h.sink) h.sink.exit(info)
      h.exitCbs.splice(0).forEach((cb) => cb(info))
    },
  }
  return h
}

module.exports = { fakeClock, fakeChild }
