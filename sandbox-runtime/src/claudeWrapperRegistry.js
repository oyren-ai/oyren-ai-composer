// The broker's session table: one setsid-detached `claude` child per session key, alive independently
// of any wrapper connection. THIS module — not the wrapper — owns the spawn() call and holds the
// child's pipes open for its whole life; setsid only protects against SIGNALS, not the EPIPE the
// child would get on its next write if whoever held its stdout pipe died. A wrapper connecting is
// just a socket attaching to an already-alive (or freshly spawned) engine.
//
// node-pty's spawn() opens the child through forkpty(), which calls setsid() internally before
// attaching the new controlling tty — so using it here gets "detached from the wrapper's process
// group" for free, on top of giving `claude` the real PTY its terminal UI expects.
const pty = require("node-pty")
const { createRingBuffer } = require("./ringBuffer")
const { filterEnv } = require("./claudeEnvAllowlist")

const CONCURRENCY_CAP = Number(process.env.OYREN_CLAUDE_WRAPPER_MAX) || 2
const IDLE_REAP_MS = Number(process.env.OYREN_CLAUDE_WRAPPER_IDLE_MS) || 30 * 60 * 1000

class CapReachedError extends Error {
  constructor(cap) {
    super(`wrapper concurrency cap (${cap}) reached — too many wrapped sessions already running`)
    this.code = "CAP_REACHED"
  }
}

/** Create one broker registry. Every dependency is injectable so tests can substitute a dummy child
 *  spawner and fake timers instead of a real `claude` + real 30-minute reap. */
function createRegistry({
  spawn = pty.spawn,
  claudeBin = process.env.OYREN_CLAUDE_BIN || "claude",
  claudeArgs = [],
  cwd = process.env.HOME || process.cwd(),
  sourceEnv = process.env,
  concurrencyCap = CONCURRENCY_CAP,
  idleReapMs = IDLE_REAP_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  const engines = new Map() // sessionKey -> EngineHandle

  function spawnEngine(sessionKey) {
    if (engines.size >= concurrencyCap) throw new CapReachedError(concurrencyCap)
    const env = filterEnv(sourceEnv)
    const child = spawn(claudeBin, claudeArgs, { name: "xterm-256color", cols: 80, rows: 24, cwd, env })
    const ring = createRingBuffer()
    const handle = {
      sessionKey,
      child,
      ring,
      connections: [], // FIFO order, oldest (longest-attached) first
      rw: null,
      idleTimer: null,
      createdAt: Date.now(),
    }
    child.onData((data) => ring.record(data))
    child.onExit(() => {
      // The child died on its own (crash/exit) — tell whoever's attached and drop the handle so the
      // next attach spawns a fresh one. This is NOT the reap path (that only fires on zero connections).
      for (const conn of handle.connections.splice(0)) {
        try { conn.onEngineExit?.() } catch { /* a bad listener must not break the others */ }
      }
      cancelIdleReap(handle)
      engines.delete(sessionKey)
    })
    engines.set(sessionKey, handle)
    return handle
  }

  function cancelIdleReap(handle) {
    if (handle.idleTimer) {
      clearTimeoutImpl(handle.idleTimer)
      handle.idleTimer = null
    }
  }

  // Reap only once NOBODY is attached — a still-attached connection means a turn could still be
  // in flight, and we don't parse the protocol to know either way. Cheap to get this wrong in the
  // reap direction: the transcript survives via claude's own --resume, so a reaped-too-early engine
  // just costs the next connection a fresh spawn instead of an instant reattach.
  function scheduleIdleReap(handle) {
    cancelIdleReap(handle)
    const timer = setTimeoutImpl(() => {
      if (handle.connections.length === 0) {
        try { handle.child.kill() } catch { /* already gone */ }
        engines.delete(handle.sessionKey)
      }
    }, idleReapMs)
    // A background reap timer must never be the thing keeping the broker process alive — only real
    // setTimeout() Timeouts support unref(); the fake numeric ids test doubles hand back do not.
    if (timer && typeof timer.unref === "function") timer.unref()
    handle.idleTimer = timer
  }

  function promoteNextRw(handle) {
    // FIFO: the longest-attached remaining connection becomes RW.
    handle.rw = handle.connections[0] || null
  }

  /** Attach a wrapper connection to `sessionKey` — spawning a fresh engine if none is running (subject
   *  to the concurrency cap; throws CapReachedError if it's full). Replays the buffered tail onto
   *  `conn.onData`, subscribes it to live output, and promotes it to RW if no RW connection currently
   *  holds the session (silent reconnect — the caller decides whether to mention it, this never does). */
  function attach(sessionKey, conn) {
    const handle = engines.get(sessionKey) || spawnEngine(sessionKey)
    cancelIdleReap(handle)
    const replay = handle.ring.snapshot()
    const unsubscribe = handle.ring.subscribe({ onLine: (data) => conn.onData(data) })
    handle.connections.push(conn)
    conn._unsubscribe = unsubscribe
    if (!handle.rw) handle.rw = conn
    return { replay, isRw: () => handle.rw === conn }
  }

  /** Detach a connection: stop its live feed, drop it from the roster, and — if it held RW — promote
   *  the next-oldest still-attached connection. Schedules the idle reap once the roster is empty. */
  function detach(sessionKey, conn) {
    const handle = engines.get(sessionKey)
    if (!handle) return
    conn._unsubscribe?.()
    const i = handle.connections.indexOf(conn)
    if (i !== -1) handle.connections.splice(i, 1)
    if (handle.rw === conn) promoteNextRw(handle)
    if (handle.connections.length === 0) scheduleIdleReap(handle)
  }

  /** Write input bytes — only from the RW connection; anyone else's write is a silent no-op (the
   *  multi-connection policy: one RW per session, everyone else read-only). Returns whether it wrote. */
  function write(sessionKey, conn, data) {
    const handle = engines.get(sessionKey)
    if (!handle || handle.rw !== conn) return false
    handle.child.write(data)
    return true
  }

  /** Resize the PTY — RW-only, same rule as write(). */
  function resize(sessionKey, conn, cols, rows) {
    const handle = engines.get(sessionKey)
    if (!handle || handle.rw !== conn) return false
    handle.child.resize(cols, rows)
    return true
  }

  function isRw(sessionKey, conn) {
    const handle = engines.get(sessionKey)
    return !!handle && handle.rw === conn
  }

  function has(sessionKey) {
    return engines.has(sessionKey)
  }

  function size() {
    return engines.size
  }

  /** Test/ops seam: force-kill every engine and clear the table (e.g. broker shutdown). Wrapper-spawned
   *  children are NOT tied to this process's lifetime in production — this exists for deterministic
   *  test teardown, not something the broker calls on a normal exit. */
  function killAll() {
    for (const handle of engines.values()) {
      cancelIdleReap(handle)
      try { handle.child.kill() } catch { /* already gone */ }
    }
    engines.clear()
  }

  return { attach, detach, write, resize, isRw, has, size, killAll }
}

module.exports = { createRegistry, CapReachedError, CONCURRENCY_CAP, IDLE_REAP_MS }
