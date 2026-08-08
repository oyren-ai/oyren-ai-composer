// config.js reads SESSION_TOKEN once at require time, so set it before requiring runsPage.js.
process.env.SESSION_TOKEN = "sekret"

const { test } = require("node:test")
const assert = require("node:assert")
const { Writable } = require("stream")
const { handleRunsPage } = require("./runsPage")

function mockRes() {
  const chunks = []
  let status = null, headers = null
  const res = new Writable({ write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb() } })
  res.writeHead = (code, h) => { status = code; headers = h || {}; return res }
  const finished = new Promise((r) => res.on("finish", r))
  return { res, finished, get status() { return status }, get headers() { return headers }, body: () => Buffer.concat(chunks).toString("utf8") }
}

const RUNS = [
  { runId: "run-b", command: "pnpm <test>", startedAt: 20, finishedAt: 25, status: "done", exitCode: 1, timedOut: false, stdout: "5 failed", stderr: "boom", truncated: false },
  { runId: "run-a", command: "pnpm install", startedAt: 10, finishedAt: null, status: "running", exitCode: null, timedOut: false, stdout: "", stderr: "", truncated: false },
]
const runningJobs = { list: () => RUNS }
const doneJobs = { list: () => [{ ...RUNS[0] }] }

test("rejects a wrong token (401)", async () => {
  const m = mockRes()
  handleRunsPage({ url: "/_oyren/runs.html?token=nope" }, m.res, { runJobs: runningJobs })
  await m.finished
  assert.equal(m.status, 401)
})

test("rejects a missing token (401)", async () => {
  const m = mockRes()
  handleRunsPage({ url: "/_oyren/runs.html" }, m.res, { runJobs: runningJobs })
  await m.finished
  assert.equal(m.status, 401)
})

test("valid token → HTML with each run's command, output, and a status badge", async () => {
  const m = mockRes()
  handleRunsPage({ url: "/_oyren/runs.html?token=sekret" }, m.res, { runJobs: runningJobs })
  await m.finished
  assert.equal(m.status, 200)
  assert.match(m.headers["content-type"], /text\/html/)
  const body = m.body()
  assert.match(body, /pnpm install/)
  assert.match(body, /5 failed/)
  assert.match(body, /● running/)
  assert.match(body, /exit 1/)
  assert.match(body, /token=sekret/) // the json-link carries the token forward
})

test("HTML-escapes the command so it can't inject markup", async () => {
  const m = mockRes()
  handleRunsPage({ url: "/_oyren/runs.html?token=sekret" }, m.res, { runJobs: runningJobs })
  await m.finished
  const body = m.body()
  assert.doesNotMatch(body, /pnpm <test>/)
  assert.match(body, /pnpm &lt;test&gt;/)
})

test("schedules a 3s reload only while a run is still running", async () => {
  const running = mockRes()
  handleRunsPage({ url: "/_oyren/runs.html?token=sekret" }, running.res, { runJobs: runningJobs })
  await running.finished
  assert.match(running.body(), /if \(true\) setTimeout/)

  const done = mockRes()
  handleRunsPage({ url: "/_oyren/runs.html?token=sekret" }, done.res, { runJobs: doneJobs })
  await done.finished
  assert.match(done.body(), /if \(false\) setTimeout/)
})
