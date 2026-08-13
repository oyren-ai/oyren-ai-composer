// Concurrency: one child PER CONNECTION — two panels get two independent, both-writable children
// (no shared engine, no read-only second seat), and the wrapper past the cap degrades loudly to a
// working direct spawn instead of a dead panel.
const { test } = require("node:test")
const assert = require("node:assert")
const { startTestBroker } = require("./helpers/testBroker")
const { spawnFakeExtension } = require("./helpers/fakeExtension")

test("concurrent: two wrappers get two independent children, and BOTH are writable", async () => {
  const broker = startTestBroker()
  await broker.ready()
  const ext1 = spawnFakeExtension({
    socketPath: broker.socketPath, dumpPath: broker.dumpPath("a"), env: { FAKE_SESSION_ID: "sid-a" },
  })
  const ext2 = spawnFakeExtension({
    socketPath: broker.socketPath, dumpPath: broker.dumpPath("b"), env: { FAKE_SESSION_ID: "sid-b" },
  })
  try {
    ext1.writeInitialize()
    ext2.writeInitialize()
    await ext1.waitForStdout('"control_response"')
    await ext2.waitForStdout('"control_response"')
    assert.equal(broker.registry.size(), 2, "two connections must mean two children")
    assert.notEqual(broker.readDump("a").pid, broker.readDump("b").pid)

    // No RW/RO seats in v2: BOTH connections' stdin must reach their own child.
    ext1.writeUserMessage("to a")
    ext2.writeUserMessage("to b")
    await ext1.waitForStdout('"result"')
    await ext2.waitForStdout('"result"')

    // Perfect isolation: each panel sees only its own child's session id.
    assert.ok(ext1.stdout().includes("sid-a") && !ext1.stdout().includes("sid-b"))
    assert.ok(ext2.stdout().includes("sid-b") && !ext2.stdout().includes("sid-a"))
  } finally {
    ext1.dispose()
    ext2.dispose()
    broker.close()
  }
})

test("concurrent: the wrapper over the cap falls back loudly and still works", async () => {
  const broker = startTestBroker({ cap: 2 })
  await broker.ready()
  const ext1 = spawnFakeExtension({ socketPath: broker.socketPath, dumpPath: broker.dumpPath("c1") })
  const ext2 = spawnFakeExtension({ socketPath: broker.socketPath, dumpPath: broker.dumpPath("c2") })
  let ext3
  try {
    ext1.writeInitialize()
    ext2.writeInitialize()
    await ext1.waitForStdout('"control_response"')
    await ext2.waitForStdout('"control_response"')

    ext3 = spawnFakeExtension({ socketPath: broker.socketPath, dumpPath: broker.dumpPath("c3") })
    ext3.writeInitialize()
    await ext3.waitForStdout('"control_response"') // still answered — by a direct spawn
    const lines = ext3.wrapperStderrLines()
    assert.equal(lines.length, 1, "over-cap must be LOUD: one stderr line")
    assert.match(lines[0], /cap \(2\) reached/)
    assert.equal(broker.registry.size(), 2, "the broker must still hold exactly the two capped children")
  } finally {
    ext1.dispose()
    ext2.dispose()
    if (ext3) ext3.dispose()
    broker.close()
  }
})
