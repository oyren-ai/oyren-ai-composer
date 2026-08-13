// The extension's wrapper contract, end to end through the REAL wrapper + REAL broker: the spawn is
// argv/env/cwd byte-faithful, the initialize handshake round-trips, stdout stays pure NDJSON with
// stderr fully separated, and nothing anywhere allocates a TTY.
const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const { startTestBroker } = require("./helpers/testBroker")
const { spawnFakeExtension, waitFor } = require("./helpers/fakeExtension")

test("contract: initialize answered through the broker; argv/env/cwd reach the child byte-exact; no TTY anywhere", async () => {
  process.env.BROKER_ONLY_SECRET = "must-never-reach-the-child" // lives in the BROKER's process env only
  const broker = startTestBroker()
  await broker.ready()
  const ext = spawnFakeExtension({
    socketPath: broker.socketPath,
    dumpPath: broker.dumpPath("c1"),
    cwd: broker.dir,
    env: { OYREN_TEST_MARKER: "pass-through-42" },
  })
  try {
    ext.writeInitialize()
    await ext.waitForStdout('"control_response"') // the extension's 60s wait, satisfied fast
    const dump = broker.readDump("c1")

    // argv fidelity: exactly what the extension passed — argv[0] is ITS chosen binary, never ours.
    assert.deepEqual(dump.argv, ext.expectedChildArgv)
    // cwd fidelity (realpath both sides — macOS tmpdirs are symlinks).
    assert.equal(fs.realpathSync(dump.cwd), fs.realpathSync(broker.dir))
    // env: the WRAPPER's env passes through whole; the BROKER's own env never leaks in.
    assert.equal(dump.env.OYREN_TEST_MARKER, "pass-through-42")
    assert.equal(dump.env.BROKER_ONLY_SECRET, undefined, "a broker-only env var must never reach the child")
    // No PTY: stream-json claude hard-fails on a TTY, so all three stdio must be pipes.
    assert.deepEqual(dump.tty, [false, false, false])
  } finally {
    ext.dispose()
    broker.close()
    delete process.env.BROKER_ONLY_SECRET
  }
})

test("contract: stdout is pure child NDJSON; the child's stderr arrives on stderr, never stdout", async () => {
  const broker = startTestBroker()
  await broker.ready()
  const ext = spawnFakeExtension({ socketPath: broker.socketPath, dumpPath: broker.dumpPath("c2") })
  try {
    ext.writeInitialize()
    await ext.waitForStdout('"control_response"')
    await waitFor(() => ext.stderr().includes("fake-claude: started"), 5000, "child stderr to arrive")

    for (const line of ext.jsonLines()) {
      assert.equal(line.unparseable, undefined, `stdout must carry only the child's NDJSON, got: ${line.unparseable}`)
    }
    assert.ok(!ext.stdout().includes("fake-claude: started"), "child stderr must never bleed into stdout")
    assert.deepEqual(ext.wrapperStderrLines(), [], "a healthy relay adds zero wrapper noise on stderr")
    assert.equal(broker.registry.size(), 1)
  } finally {
    ext.dispose()
    broker.close()
  }
})
