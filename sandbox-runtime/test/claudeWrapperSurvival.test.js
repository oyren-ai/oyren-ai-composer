// Level B survival, proven with real processes: a panel close (SIGKILL of the wrapper) mid-turn
// must not touch the child — the broker drains it: the turn completes, the transcript-flush marker
// appears, and the child exits 0 via stdin EOF, never via a signal. A reopened panel gets a brand-
// new child with zero replayed bytes from the old one (resume happens via claude's own --resume).
const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const { startTestBroker } = require("./helpers/testBroker")
const { spawnFakeExtension, waitFor } = require("./helpers/fakeExtension")

const isAlive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

test("survival: SIGKILL mid-turn — child lives, finishes the turn, flushes, exits 0 via stdin EOF", async () => {
  const broker = startTestBroker()
  await broker.ready()
  const dump = broker.dumpPath("s1")
  const ext = spawnFakeExtension({
    socketPath: broker.socketPath,
    dumpPath: dump,
    env: { FAKE_TURN_MS: "700", FAKE_SESSION_ID: "sid-survival" },
  })
  try {
    ext.writeInitialize()
    await ext.waitForStdout('"control_response"')
    ext.writeUserMessage("long turn")
    await ext.waitForStdout('"assistant"') // the turn is now in flight

    ext.child.kill("SIGKILL") // worst case: no 's' frame, no goodbye — just a dead socket
    await ext.waitExit()

    const childPid = JSON.parse(fs.readFileSync(dump, "utf8")).pid
    assert.ok(isAlive(childPid), "the claude child must survive the wrapper's SIGKILL")

    await waitFor(() => fs.existsSync(`${dump}.flushed`), 5000, "transcript-flushed marker")
    assert.equal(fs.readFileSync(`${dump}.flushed`, "utf8"), "sid-survival")
    assert.equal(fs.existsSync(`${dump}.killed`), false, "the child must exit via stdin EOF, never a signal")
    await waitFor(() => !isAlive(childPid), 3000, "drained child to exit")
    assert.equal(broker.registry.size(), 0, "the dead wrapper's cap slot must be freed")
  } finally {
    ext.dispose()
    broker.close()
  }
})

test("survival: a reopened wrapper gets a NEW child and zero replayed bytes from the old one", async () => {
  const broker = startTestBroker()
  await broker.ready()
  const ext1 = spawnFakeExtension({
    socketPath: broker.socketPath,
    dumpPath: broker.dumpPath("old"),
    env: { FAKE_TURN_MS: "400", FAKE_SESSION_ID: "sid-old" },
  })
  let ext2
  try {
    ext1.writeInitialize()
    await ext1.waitForStdout('"control_response"')
    ext1.writeUserMessage("turn that outlives the panel")
    await ext1.waitForStdout('"assistant"')
    ext1.child.kill("SIGKILL")
    await ext1.waitExit()

    // The panel reopens while the old child is still draining.
    ext2 = spawnFakeExtension({
      socketPath: broker.socketPath,
      dumpPath: broker.dumpPath("new"),
      env: { FAKE_SESSION_ID: "sid-new" },
    })
    ext2.writeInitialize()
    await ext2.waitForStdout('"control_response"')

    const oldDump = broker.readDump("old")
    const newDump = broker.readDump("new")
    assert.notEqual(newDump.pid, oldDump.pid, "a reopened panel must get a brand-new child")
    assert.ok(!ext2.stdout().includes("sid-old"), "zero replayed foreign bytes from the previous child")
    for (const line of ext2.jsonLines()) {
      if (line.session_id) assert.equal(line.session_id, "sid-new")
    }
  } finally {
    ext1.dispose()
    if (ext2) ext2.dispose()
    broker.close()
  }
})
