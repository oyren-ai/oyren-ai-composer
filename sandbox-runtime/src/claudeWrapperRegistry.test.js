const { test } = require("node:test")
const assert = require("node:assert")
const { createRegistry } = require("./claudeWrapperRegistry")

/** A fake IPty: no real process, but the same onData/onExit/write/resize/kill surface node-pty gives
 *  us, plus test hooks (`emitData`, `emitExit`) to drive it deterministically. */
function fakePty() {
  const dataHandlers = []
  const exitHandlers = []
  const writes = []
  const resizes = []
  let killed = false
  return {
    onData: (cb) => dataHandlers.push(cb),
    onExit: (cb) => exitHandlers.push(cb),
    write: (d) => writes.push(d),
    resize: (c, r) => resizes.push([c, r]),
    kill: () => { killed = true },
    emitData: (d) => dataHandlers.forEach((cb) => cb(d)),
    emitExit: () => exitHandlers.forEach((cb) => cb()),
    writes,
    resizes,
    get killed() { return killed },
  }
}

/** Fake timer pair: setTimeoutImpl/clearTimeoutImpl that never actually schedule — `fireAll()` runs
 *  every still-pending callback synchronously, in registration order, so idle-reap tests are instant
 *  and deterministic instead of waiting on the real 30-minute default. */
function fakeTimers() {
  const pending = new Map()
  let nextId = 1
  const setTimeoutImpl = (fn, ms) => {
    const id = nextId++
    pending.set(id, { fn, ms })
    return id
  }
  const clearTimeoutImpl = (id) => pending.delete(id)
  const fireAll = () => {
    const toRun = [...pending.values()]
    pending.clear()
    toRun.forEach(({ fn }) => fn())
  }
  return { setTimeoutImpl, clearTimeoutImpl, fireAll, pendingCount: () => pending.size }
}

function makeRegistry(overrides = {}) {
  const spawned = []
  const spawn = (bin, args, opts) => {
    const child = fakePty()
    spawned.push({ bin, args, opts, child })
    return child
  }
  const timers = fakeTimers()
  const registry = createRegistry({
    spawn,
    claudeBin: "claude",
    cwd: "/home/oyren",
    sourceEnv: { PATH: "/bin", HOME: "/home/oyren", GITHUB_TOKEN: "should-never-reach-spawn" },
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    ...overrides,
  })
  return { registry, spawned, timers }
}

function conn() {
  const received = []
  let exited = false
  return { onData: (d) => received.push(d), onEngineExit: () => { exited = true }, received, get exited() { return exited } }
}

test("first attach spawns a fresh engine and becomes RW", () => {
  const { registry, spawned } = makeRegistry()
  const c1 = conn()
  const { replay, isRw } = registry.attach("s1", c1)
  assert.equal(spawned.length, 1)
  assert.deepEqual(replay, [])
  assert.equal(isRw(), true)
})

test("a second attach to the SAME session key reuses the engine — no second spawn", () => {
  const { registry, spawned } = makeRegistry()
  registry.attach("s1", conn())
  registry.attach("s1", conn())
  assert.equal(spawned.length, 1)
})

test("spawn only ever sees the allowlist-filtered env, never the raw source env", () => {
  const { registry, spawned } = makeRegistry()
  registry.attach("s1", conn())
  assert.equal(spawned[0].opts.env.GITHUB_TOKEN, undefined)
  assert.equal(spawned[0].opts.env.PATH, "/bin")
})

test("replay: a connection attaching later sees everything recorded before it joined", () => {
  const { registry, spawned } = makeRegistry()
  registry.attach("s1", conn())
  spawned[0].child.emitData("line-1")
  spawned[0].child.emitData("line-2")
  const c2 = conn()
  const { replay } = registry.attach("s1", c2)
  assert.deepEqual(replay, ["line-1", "line-2"])
})

test("live data after attach reaches every attached connection's onData", () => {
  const { registry, spawned } = makeRegistry()
  const c1 = conn(); const c2 = conn()
  registry.attach("s1", c1)
  registry.attach("s1", c2)
  spawned[0].child.emitData("hello")
  assert.deepEqual(c1.received, ["hello"])
  assert.deepEqual(c2.received, ["hello"])
})

test("a second simultaneous connection is read-only; the first keeps RW", () => {
  const { registry } = makeRegistry()
  const c1 = conn(); const c2 = conn()
  const a1 = registry.attach("s1", c1)
  const a2 = registry.attach("s1", c2)
  assert.equal(a1.isRw(), true)
  assert.equal(a2.isRw(), false)
  assert.equal(registry.isRw("s1", c1), true)
  assert.equal(registry.isRw("s1", c2), false)
})

test("only the RW connection's writes reach the child; RO writes are a silent no-op", () => {
  const { registry, spawned } = makeRegistry()
  const c1 = conn(); const c2 = conn()
  registry.attach("s1", c1)
  registry.attach("s1", c2)
  assert.equal(registry.write("s1", c1, "rw input"), true)
  assert.equal(registry.write("s1", c2, "ro input — must be dropped"), false)
  assert.deepEqual(spawned[0].child.writes, ["rw input"])
})

test("resize follows the same RW-only rule as write", () => {
  const { registry, spawned } = makeRegistry()
  const c1 = conn(); const c2 = conn()
  registry.attach("s1", c1)
  registry.attach("s1", c2)
  assert.equal(registry.resize("s1", c1, 100, 40), true)
  assert.equal(registry.resize("s1", c2, 1, 1), false)
  assert.deepEqual(spawned[0].child.resizes, [[100, 40]])
})

test("RW promotes FIFO to the next-oldest still-attached connection on disconnect", () => {
  const { registry } = makeRegistry()
  const c1 = conn(); const c2 = conn(); const c3 = conn()
  registry.attach("s1", c1) // RW
  registry.attach("s1", c2)
  registry.attach("s1", c3)
  registry.detach("s1", c1)
  assert.equal(registry.isRw("s1", c2), true, "c2 was next-oldest, should be promoted")
  assert.equal(registry.isRw("s1", c3), false)
})

test("detaching a read-only connection does not disturb who holds RW", () => {
  const { registry } = makeRegistry()
  const c1 = conn(); const c2 = conn()
  registry.attach("s1", c1)
  registry.attach("s1", c2)
  registry.detach("s1", c2)
  assert.equal(registry.isRw("s1", c1), true)
})

test("a reconnect after everyone detaches spawns nobody new and is silent (no marker) — replays the tail", () => {
  const { registry, spawned } = makeRegistry()
  const c1 = conn()
  registry.attach("s1", c1)
  spawned[0].child.emitData("before-disconnect")
  registry.detach("s1", c1)
  const c2 = conn()
  const { replay, isRw } = registry.attach("s1", c2)
  assert.equal(spawned.length, 1, "must not spawn a second engine — the first is still alive")
  assert.deepEqual(replay, ["before-disconnect"])
  assert.equal(isRw(), true, "reconnecting after everyone left becomes RW again")
})

test("detach stops delivery of further live data to that connection", () => {
  const { registry, spawned } = makeRegistry()
  const c1 = conn()
  registry.attach("s1", c1)
  registry.detach("s1", c1)
  spawned[0].child.emitData("after-detach")
  assert.deepEqual(c1.received, [])
})

test("idle reap: zero connections for the full window kills the child and frees the session key", () => {
  const { registry, spawned, timers } = makeRegistry()
  const c1 = conn()
  registry.attach("s1", c1)
  registry.detach("s1", c1)
  assert.equal(timers.pendingCount(), 1, "a reap timer should be scheduled once nobody's attached")
  assert.equal(spawned[0].child.killed, false)
  timers.fireAll()
  assert.equal(spawned[0].child.killed, true)
  // The session key is free again — the next attach spawns a brand-new engine.
  registry.attach("s1", conn())
  assert.equal(spawned.length, 2)
})

test("idle reap is cancelled by a reconnect before the window elapses", () => {
  const { registry, spawned, timers } = makeRegistry()
  const c1 = conn()
  registry.attach("s1", c1)
  registry.detach("s1", c1)
  registry.attach("s1", conn()) // reconnects before the timer fires
  assert.equal(timers.pendingCount(), 0, "the pending reap must be cancelled on reattach")
  timers.fireAll() // no-op: nothing pending
  assert.equal(spawned[0].child.killed, false)
  assert.equal(spawned.length, 1)
})

test("the concurrency cap rejects a spawn for a NEW session once it's full, without disturbing existing ones", () => {
  const { registry, spawned } = makeRegistry({ concurrencyCap: 2 })
  registry.attach("s1", conn())
  registry.attach("s2", conn())
  assert.throws(() => registry.attach("s3", conn()), /concurrency cap \(2\) reached/)
  assert.equal(spawned.length, 2)
  assert.equal(registry.has("s1"), true)
  assert.equal(registry.has("s2"), true)
  assert.equal(registry.has("s3"), false)
})

test("an engine that exits on its own notifies every attached connection and frees the session key", () => {
  const { registry, spawned } = makeRegistry()
  const c1 = conn(); const c2 = conn()
  registry.attach("s1", c1)
  registry.attach("s1", c2)
  spawned[0].child.emitExit()
  assert.equal(c1.exited, true)
  assert.equal(c2.exited, true)
  assert.equal(registry.has("s1"), false)
  // The key is free — a fresh attach spawns a new engine rather than reusing the dead one.
  registry.attach("s1", conn())
  assert.equal(spawned.length, 2)
})

test("killAll force-kills every live engine and clears the table", () => {
  const { registry, spawned } = makeRegistry()
  registry.attach("s1", conn())
  registry.attach("s2", conn())
  registry.killAll()
  assert.equal(spawned[0].child.killed, true)
  assert.equal(spawned[1].child.killed, true)
  assert.equal(registry.has("s1"), false)
  assert.equal(registry.has("s2"), false)
})
