// The resume-race hold: `--resume <sid>` must wait for the draining child that OWNS that session
// to finish flushing (capped) before the new child spawns and reads the session file.
const { test } = require("node:test")
const assert = require("node:assert")
const { createRegistry, RESUME_WAIT_MS } = require("./claudeWrapperRegistry")
const { fakeClock, fakeChild } = require("../test/helpers/fakes")

const helloOf = (argv) => ({ v: 2, argv, cwd: "/w", env: { PATH: "/bin" }, pid: 1 })
const settle = () => new Promise((r) => setImmediate(r))

function makeRegistry() {
  const clock = fakeClock()
  const spawned = []
  const registry = createRegistry({
    drainMs: 1000, log: () => {},
    spawnChild: (spec) => { const child = fakeChild(); spawned.push({ spec, child }); return child },
    setTimeoutImpl: clock.set, clearTimeoutImpl: clock.clear,
  })
  return { registry, spawned, clock }
}

/** A claimed session mid-turn on session `sid`, then disconnected — i.e. actively draining. */
async function drainingSession({ registry, spawned }, sid) {
  const res = await registry.claim(helloOf(["/ext/claude", "--output-format", "stream-json"]))
  spawned[0].child.emitStdout(`{"type":"system","subtype":"init","session_id":"${sid}"}\n`)
  res.session.write(Buffer.from('{"type":"user","message":{}}\n')) // busy — the drain will wait
  res.session.disconnect()
  return res
}

test("a --resume claim for a draining session holds until that child exits, then spawns", async () => {
  const bundle = makeRegistry()
  const { registry, spawned } = bundle
  await drainingSession(bundle, "sid-flushing")

  let resolved = null
  const pending = registry.claim(helloOf(["/ext/claude", "--resume", "sid-flushing"]))
    .then((r) => { resolved = r; return r })
  await settle()
  assert.equal(resolved, null, "the resume must wait while its session file is still being written")
  assert.equal(spawned.length, 1, "and must not have spawned yet")

  spawned[0].child.emitExit({ code: 0, signal: null }) // flush complete
  const res = await pending
  assert.equal(res.ok, true)
  assert.equal(spawned.length, 2, "the resume spawns only after the old child is gone")
})

test("the hold is capped: a wedged draining child releases the resume after RESUME_WAIT_MS", async () => {
  const bundle = makeRegistry()
  const { registry, spawned, clock } = bundle
  await drainingSession(bundle, "sid-wedged")

  let resolved = null
  const pending = registry.claim(helloOf(["/ext/claude", "--resume", "sid-wedged"]))
    .then((r) => { resolved = r; return r })
  await settle()
  assert.equal(resolved, null)
  clock.advance(RESUME_WAIT_MS) // the old child never exits — stop holding the new panel hostage
  const res = await pending
  assert.equal(res.ok, true)
  assert.equal(spawned.length, 2)
})

test("a --resume for an UNRELATED session spawns immediately — no hold", async () => {
  const bundle = makeRegistry()
  const { registry, spawned } = bundle
  await drainingSession(bundle, "sid-other")
  const res = await registry.claim(helloOf(["/ext/claude", "--resume", "sid-unrelated"]))
  assert.equal(res.ok, true)
  assert.equal(spawned.length, 2)
})
