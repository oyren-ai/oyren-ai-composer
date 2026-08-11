const { test } = require("node:test")
const assert = require("node:assert")
const net = require("net")
const os = require("os")
const path = require("path")
const fs = require("fs")
const { startSocketServer, parseHandshake } = require("./claudeWrapperSocket")
const { createRegistry } = require("./claudeWrapperRegistry")

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms))

function tmpSocketPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wrapper-sock-")), "broker.sock")
}

/** A fake IPty the same shape node-pty gives claudeWrapperRegistry, driven manually by the test. */
function fakePty() {
  const dataHandlers = []
  const writes = []
  return {
    onData: (cb) => dataHandlers.push(cb),
    onExit: () => {},
    write: (d) => writes.push(d.toString("utf8")),
    resize: () => {},
    kill: () => {},
    emitData: (d) => dataHandlers.forEach((cb) => cb(d)),
    writes,
  }
}

function makeRegistry() {
  const spawned = []
  const spawn = () => {
    const child = fakePty()
    spawned.push(child)
    return child
  }
  return { registry: createRegistry({ spawn, sourceEnv: { PATH: "/bin" } }), spawned }
}

/** A test harness bundling a live socket server + a place to track every client socket it opens, so
 *  `close()` can force-destroy stragglers regardless of which assertion failed — real open sockets
 *  keep node:test's process alive past the last reported result otherwise. */
function harness(registryBundle = makeRegistry(), opts) {
  const { registry, spawned } = registryBundle
  const socketPath = tmpSocketPath()
  const server = startSocketServer(socketPath, registry, opts)
  const clients = []

  /** Connect a raw client socket, send the handshake, wait for the round trip to settle, and collect
   *  every byte it receives as decoded text. */
  async function connect(sessionKey) {
    const socket = net.createConnection(socketPath)
    clients.push(socket)
    const received = []
    socket.on("data", (d) => received.push(d.toString("utf8")))
    await new Promise((resolve, reject) => {
      socket.on("connect", () => { socket.write(JSON.stringify({ sessionKey }) + "\n"); resolve() })
      socket.on("error", reject)
    })
    await settle() // let the handshake round-trip (attach + any replay) actually land
    return { socket, received }
  }

  function close() {
    for (const s of clients) { try { s.destroy() } catch { /* already gone */ } }
    registry.killAll()
    server.close()
  }

  return { registry, spawned, socketPath, connect, close }
}

test("parseHandshake: no newline yet returns null (wait for more bytes)", () => {
  assert.equal(parseHandshake(Buffer.from('{"sessionKey":"x"'), "default"), null)
})

test("parseHandshake: valid JSON extracts the session key and any trailing bytes", () => {
  const r = parseHandshake(Buffer.from('{"sessionKey":"abc"}\nHELLO'), "default")
  assert.equal(r.sessionKey, "abc")
  assert.equal(r.rest.toString("utf8"), "HELLO")
})

test("parseHandshake: malformed JSON falls back to the default key rather than rejecting", () => {
  const r = parseHandshake(Buffer.from("not json\nrest"), "default")
  assert.equal(r.sessionKey, "default")
  assert.equal(r.rest.toString("utf8"), "rest")
})

test("a client attaching gets replay of everything recorded before it connected", async () => {
  const h = harness()
  try {
    // Prime an engine with output before anyone connects, via a throwaway first attach.
    h.registry.attach("s1", { onData: () => {}, onEngineExit: () => {} })
    h.spawned[0].emitData("early-output")
    const { received } = await h.connect("s1")
    assert.ok(received.join("").includes("early-output"))
  } finally {
    h.close()
  }
})

test("data written by the client after the handshake reaches the engine as input (it's RW)", async () => {
  const h = harness()
  try {
    const { socket } = await h.connect("s1")
    socket.write("keystroke")
    await settle()
    assert.deepEqual(h.spawned[0].writes, ["keystroke"])
  } finally {
    h.close()
  }
})

test("bytes arriving in the same chunk as the handshake line are not dropped", async () => {
  const h = harness()
  try {
    const socket = net.createConnection(h.socketPath, () => {
      socket.write(JSON.stringify({ sessionKey: "s1" }) + "\nleftover-bytes")
    })
    await settle()
    assert.deepEqual(h.spawned[0].writes, ["leftover-bytes"])
    socket.destroy()
  } finally {
    h.close()
  }
})

test("a second connection's write, while it only holds RO, never reaches the engine", async () => {
  const h = harness()
  try {
    await h.connect("shared")
    const c2 = await h.connect("shared")
    c2.socket.write("ro-input-must-be-dropped")
    await settle()
    assert.deepEqual(h.spawned[0].writes, [])
  } finally {
    h.close()
  }
})

test("two clients on the same session key: the first is RW, the second gets a live tee (RO)", async () => {
  const h = harness()
  try {
    const c1 = await h.connect("shared")
    const c2 = await h.connect("shared")
    h.spawned[0].emitData("broadcast-to-both")
    await settle()
    assert.ok(c1.received.join("").includes("broadcast-to-both"))
    assert.ok(c2.received.join("").includes("broadcast-to-both"))
  } finally {
    h.close()
  }
})

test("closing a client socket detaches it — a fresh connection still finds the SAME engine (no respawn)", async () => {
  const h = harness()
  try {
    const c1 = await h.connect("s1")
    c1.socket.end()
    await settle()
    await h.connect("s1")
    assert.equal(h.spawned.length, 1, "the engine must survive the socket closing — this IS the disconnect-survival property")
  } finally {
    h.close()
  }
})

test("a missing/empty handshake session key falls back to the well-known default key", async () => {
  const h = harness(makeRegistry(), { fallbackSessionKey: "well-known" })
  try {
    await h.connect("") // empty sessionKey — parseHandshake treats it as absent
    assert.equal(h.registry.has("well-known"), true)
  } finally {
    h.close()
  }
})

test("the socket file is created chmod 0700 — never group/world accessible", async () => {
  const h = harness()
  try {
    await settle()
    const mode = fs.statSync(h.socketPath).mode & 0o777
    assert.equal(mode, 0o700)
  } finally {
    h.close()
  }
})
