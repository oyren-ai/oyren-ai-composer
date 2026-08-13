const { test } = require("node:test")
const assert = require("node:assert")
const { createRegistry } = require("./claudeWrapperRegistry")
const { fakeClock, fakeChild } = require("../test/helpers/fakes")

const helloOf = (over = {}) => ({
  v: 2, argv: ["/ext/claude", "--output-format", "stream-json"], cwd: "/workspace",
  env: { PATH: "/bin", OYREN_SESSION_SECRET: "hunter2" }, pid: 7, ...over,
})

function makeRegistry(opts = {}) {
  const clock = fakeClock()
  const spawned = []
  const logs = []
  const registry = createRegistry({
    drainMs: 1000,
    spawnChild: (spec) => { const child = fakeChild(); spawned.push({ spec, child }); return child },
    log: (m) => logs.push(m),
    setTimeoutImpl: clock.set, clearTimeoutImpl: clock.clear,
    ...opts,
  })
  return { registry, spawned, logs, clock }
}

test("the child is spawned with hello.env ALONE — the broker's own env never bleeds in", async () => {
  process.env.BROKER_PROCESS_ONLY_VAR = "must-not-leak"
  try {
    const { registry, spawned } = makeRegistry()
    const res = await registry.claim(helloOf())
    assert.equal(res.ok, true)
    assert.deepEqual(spawned[0].spec.env, { PATH: "/bin", OYREN_SESSION_SECRET: "hunter2" })
    assert.equal("BROKER_PROCESS_ONLY_VAR" in spawned[0].spec.env, false)
    assert.deepEqual(spawned[0].spec.argv, helloOf().argv)
    assert.equal(spawned[0].spec.cwd, "/workspace")
  } finally {
    delete process.env.BROKER_PROCESS_ONLY_VAR
  }
})

test("the cap refuses with {ok:false}; a disconnect frees the slot even while its child drains", async () => {
  const { registry, spawned } = makeRegistry({ cap: 1 })
  const first = await registry.claim(helloOf())
  assert.equal(first.ok, true)
  const refused = await registry.claim(helloOf())
  assert.equal(refused.ok, false)
  assert.match(refused.error, /cap \(1\) reached/)
  assert.equal(spawned.length, 1, "a refused claim must not have spawned anything")

  first.session.write(Buffer.from('{"type":"user","message":{}}\n')) // mid-turn...
  first.session.disconnect() // ...panel closes: slot freed NOW, child keeps draining
  assert.equal(registry.size(), 0)
  assert.equal(registry.drainingSize(), 1)
  assert.equal(spawned[0].child.stdinClosed, false, "busy child must still be waiting out its turn")
  const second = await registry.claim(helloOf())
  assert.equal(second.ok, true, "the reopened panel must never be refused for its predecessor's drain")
})

test("every hello is logged with argv, cwd and env KEY NAMES — never env values", async () => {
  const { registry, logs } = makeRegistry()
  await registry.claim(helloOf())
  const all = logs.join("\n")
  assert.match(all, /"--output-format"/)
  assert.match(all, /cwd=\/workspace/)
  assert.match(all, /OYREN_SESSION_SECRET/)
  assert.ok(!all.includes("hunter2"), "an env VALUE in the logs is a secret leak")
})

test("killAll reaps active and draining children alike", async () => {
  const { registry, spawned } = makeRegistry()
  const a = await registry.claim(helloOf())
  const b = await registry.claim(helloOf())
  b.session.write(Buffer.from('{"type":"user","message":{}}\n'))
  b.session.disconnect() // draining
  registry.killAll()
  assert.equal(spawned[0].child.killed, true)
  assert.equal(spawned[1].child.killed, true)
  assert.equal(registry.size() + registry.drainingSize(), 0)
  a.session.release() // idempotent after killAll — must not throw
})
