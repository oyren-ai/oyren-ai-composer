// Shared stubs for the agent HTTP + engine tests: a response fake that records status/chunks, a request
// driver that pushes a body through an async handler exactly the way the router does, and a fake Agent SDK
// `query` so engine tests never spawn the real SDK/claude. Deliberately NOT a *.test.js file so
// `node --test` never runs it. Callers set SESSION_TOKEN before requiring (config reads it at require-time).
const { EventEmitter } = require("node:events")

function fakeRes() {
  const res = new EventEmitter()
  res.chunks = []
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; res.headersSent = true }
  res.write = (c) => { res.chunks.push(c.toString()) }
  res.end = (c) => { if (c) res.chunks.push(c.toString()); res.writableEnded = true; res.emit("finish") }
  res.body = () => res.chunks.join("")
  res.lines = () => res.chunks.join("").split("\n").filter(Boolean)
  return res
}

/** Drive a request through an (async) handler and resolve with the response once it settles. */
async function drive(handler, { method = "GET", url = "/", body = null } = {}) {
  const req = new EventEmitter(); req.method = method; req.url = url
  const res = fakeRes()
  const done = handler(req, res)
  if (body != null) req.emit("data", Buffer.from(body))
  req.emit("end")
  await done
  return res
}

// A controllable fake of the SDK: `query({prompt,options})` returns an async-generator Query. Pushed
// messages surface on the generator; it records the user messages read from `prompt` and the control calls.
function makeFakeSdk({ models = [{ value: "opus", displayName: "Opus" }] } = {}) {
  const outbox = []; let wake = null; const inputs = []
  const calls = { interrupt: 0, setModel: [], starts: 0, options: null }
  const bump = () => { if (wake) { const w = wake; wake = null; w() } }
  const emit = (m) => { outbox.push(m); bump() }
  async function* gen() { while (true) { if (outbox.length) { yield outbox.shift(); continue } await new Promise((r) => { wake = r }) } }
  function query({ prompt, options }) {
    calls.starts++; calls.options = options
    const q = gen()
    q.interrupt = async () => { calls.interrupt++ }
    q.setModel = async (m) => { calls.setModel.push(m) }
    q.supportedModels = async () => models
    ;(async () => { for await (const msg of prompt) inputs.push(msg) })()
    return q
  }
  return { query, emit, inputs, calls }
}

// One stream-json `user` line the way the oyren-ai client encodes it; turn_id rides top-level.
function userLine(text, turnId) {
  return JSON.stringify({ type: "user", turn_id: turnId, message: { role: "user", content: [{ type: "text", text }] } })
}
const resultLine = () => JSON.stringify({ type: "result", subtype: "success" })

module.exports = { fakeRes, drive, makeFakeSdk, userLine, resultLine }
