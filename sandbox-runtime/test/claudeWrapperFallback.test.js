// Fallback discipline: any broker failure BEFORE output has flowed degrades to a direct spawn with
// exactly ONE wrapper line on stderr and an untouched stdout — and the flag off never even looks at
// the socket. A broken broker must never leave the Chat panel dead.
const { test } = require("node:test")
const assert = require("node:assert")
const net = require("net")
const os = require("os")
const path = require("path")
const fs = require("fs")
const { spawnFakeExtension, waitFor } = require("./helpers/fakeExtension")
const { startTestBroker } = require("./helpers/testBroker")

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "wrapper-fallback-"))

async function expectLoudFallback(ext, pattern) {
  ext.writeInitialize() // written BEFORE the fallback lands — the bytes must still reach the child
  await ext.waitForStdout('"control_response"', 8000)
  const lines = ext.wrapperStderrLines()
  assert.equal(lines.length, 1, `exactly one wrapper stderr line, got: ${JSON.stringify(lines)}`)
  assert.match(lines[0], /falling back to a direct spawn/)
  assert.match(lines[0], pattern)
  for (const line of ext.jsonLines()) assert.equal(line.unparseable, undefined, "stdout must stay clean NDJSON")
}

test("fallback: broker down — passthrough works, one stderr line, clean stdout", async () => {
  const dir = tmpDir()
  const ext = spawnFakeExtension({ socketPath: path.join(dir, "nobody-home.sock"), dumpPath: path.join(dir, "d.json") })
  try {
    await expectLoudFallback(ext, /broker unreachable/)
  } finally { ext.dispose() }
})

test("fallback: a broker that accepts but never acks trips the 1500ms timeout", async () => {
  const dir = tmpDir()
  const socketPath = path.join(dir, "mute.sock")
  const muteServer = net.createServer(() => { /* accept, say nothing, forever */ })
  await new Promise((r) => muteServer.listen(socketPath, r))
  const started = Date.now()
  const ext = spawnFakeExtension({ socketPath, dumpPath: path.join(dir, "d.json") })
  try {
    await expectLoudFallback(ext, /did not ack within 1500ms/)
    assert.ok(Date.now() - started >= 1400, "must have actually waited out the ack window")
  } finally {
    ext.dispose()
    muteServer.close()
  }
})

test("fallback: a broker at cap refuses with {ok:false} and the wrapper degrades loudly", async () => {
  const broker = startTestBroker({ cap: 0 }) // full before anyone arrives
  await broker.ready()
  const ext = spawnFakeExtension({ socketPath: broker.socketPath, dumpPath: broker.dumpPath("d") })
  try {
    await expectLoudFallback(ext, /broker refused.*cap/)
    assert.equal(broker.registry.size(), 0)
  } finally {
    ext.dispose()
    broker.close()
  }
})

test("fallback: the flag off is pure passthrough — the socket is never touched", async () => {
  const dir = tmpDir()
  const socketPath = path.join(dir, "counting.sock")
  let connections = 0
  const countingServer = net.createServer(() => { connections += 1 })
  await new Promise((r) => countingServer.listen(socketPath, r))
  const ext = spawnFakeExtension({ socketPath, dumpPath: path.join(dir, "d.json"), flagOn: false })
  try {
    ext.writeInitialize()
    await ext.waitForStdout('"control_response"')
    await waitFor(() => fs.existsSync(path.join(dir, "d.json")), 3000, "dump")
    assert.equal(connections, 0, "flag off must never even attempt the broker connection")
    assert.deepEqual(ext.wrapperStderrLines(), [], "flag off is silent — indistinguishable from no wrapper")
  } finally {
    ext.dispose()
    countingServer.close()
  }
})
