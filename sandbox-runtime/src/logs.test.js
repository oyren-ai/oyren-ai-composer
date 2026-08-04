// config.js reads SESSION_TOKEN once at require time, so set it before requiring logs.js.
process.env.SESSION_TOKEN = "sekret"

const { test } = require("node:test")
const assert = require("node:assert")
const { Writable } = require("stream")
const { handleLogs, formatLine } = require("./logs")
const { record, reset } = require("./logBuffer")

test.beforeEach(() => reset())

function mockRes() {
  const chunks = []
  let status = null, headers = null
  const res = new Writable({ write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb() } })
  res.writeHead = (code, h) => { status = code; headers = h || {}; return res }
  const finished = new Promise((r) => res.on("finish", r))
  return { res, finished, get status() { return status }, get headers() { return headers }, body: () => Buffer.concat(chunks).toString("utf8") }
}

test("rejects a request with a wrong token (401)", async () => {
  const m = mockRes()
  handleLogs({ url: "/_oyren/logs?token=nope" }, m.res)
  await m.finished
  assert.equal(m.status, 401)
})

test("rejects a request with no token (401)", async () => {
  const m = mockRes()
  handleLogs({ url: "/_oyren/logs" }, m.res)
  await m.finished
  assert.equal(m.status, 401)
})

test("returns an HTML page embedding the buffered lines for a valid token", async () => {
  record("stdout", "server booted")
  const m = mockRes()
  handleLogs({ url: "/_oyren/logs?token=sekret" }, m.res)
  await m.finished
  assert.equal(m.status, 200)
  assert.match(m.headers["content-type"], /text\/html/)
  assert.match(m.body(), /server booted/)
  assert.match(m.body(), /token=sekret/) // the raw-link and poll URL carry the token forward
})

test("HTML-escapes buffered log text so it can't inject markup", async () => {
  record("stdout", "<script>alert(1)</script>")
  const m = mockRes()
  handleLogs({ url: "/_oyren/logs?token=sekret" }, m.res)
  await m.finished
  assert.doesNotMatch(m.body(), /<script>alert/)
  assert.match(m.body(), /&lt;script&gt;/)
})

test("/_oyren/logs/raw returns a plain-text tail", async () => {
  record("stdout", "hello")
  record("stderr", "uh oh")
  const m = mockRes()
  handleLogs({ url: "/_oyren/logs/raw?token=sekret" }, m.res)
  await m.finished
  assert.equal(m.status, 200)
  assert.match(m.headers["content-type"], /text\/plain/)
  assert.match(m.body(), /hello/)
  assert.match(m.body(), /uh oh/)
})

test("/_oyren/logs/raw with no buffered output says so instead of being blank", async () => {
  const m = mockRes()
  handleLogs({ url: "/_oyren/logs/raw?token=sekret" }, m.res)
  await m.finished
  assert.match(m.body(), /no output yet/)
})

test("formatLine marks stderr lines distinctly from stdout", () => {
  const stdout = formatLine({ t: 0, stream: "stdout", text: "ok" })
  const stderr = formatLine({ t: 0, stream: "stderr", text: "bad" })
  assert.notEqual(stdout, stderr)
  assert.match(stderr, /!/)
})
