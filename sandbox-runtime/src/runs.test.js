// config.js reads SESSION_TOKEN once at require time, so set it before requiring runs.js.
process.env.SESSION_TOKEN = "sekret"

const { test } = require("node:test")
const assert = require("node:assert")
const { Writable } = require("stream")
const { handleRuns } = require("./runs")

function mockRes() {
  const chunks = []
  let status = null, headers = null
  const res = new Writable({ write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb() } })
  res.writeHead = (code, h) => { status = code; headers = h || {}; return res }
  const finished = new Promise((r) => res.on("finish", r))
  return { res, finished, get status() { return status }, get headers() { return headers }, json: () => JSON.parse(Buffer.concat(chunks).toString("utf8")) }
}

const RUNS = [
  { runId: "run-b", command: "pnpm test", startedAt: 20, finishedAt: 25, status: "done", exitCode: 1, timedOut: false, stdout: "5 failed", stderr: "", truncated: false },
  { runId: "run-a", command: "pnpm install", startedAt: 10, finishedAt: null, status: "running", exitCode: null, timedOut: false, stdout: "", stderr: "", truncated: false },
]
const fakeJobs = {
  list: () => RUNS,
  get: (id) => RUNS.find((r) => r.runId === id) || null,
}

test("rejects a wrong token (401)", async () => {
  const m = mockRes()
  handleRuns({ url: "/_oyren/runs?token=nope" }, m.res, { runJobs: fakeJobs })
  await m.finished
  assert.equal(m.status, 401)
})

test("rejects a missing token (401)", async () => {
  const m = mockRes()
  handleRuns({ url: "/_oyren/runs" }, m.res, { runJobs: fakeJobs })
  await m.finished
  assert.equal(m.status, 401)
})

test("valid token → the runs list, newest-first, with CORS headers", async () => {
  const m = mockRes()
  handleRuns({ url: "/_oyren/runs?token=sekret" }, m.res, { runJobs: fakeJobs })
  await m.finished
  assert.equal(m.status, 200)
  assert.deepEqual(m.json(), { runs: RUNS })
  assert.equal(m.headers["Access-Control-Allow-Origin"], "*")
})

test("?runId= returns a single run's full output", async () => {
  const m = mockRes()
  handleRuns({ url: "/_oyren/runs?token=sekret&runId=run-b", }, m.res, { runJobs: fakeJobs })
  await m.finished
  assert.equal(m.status, 200)
  assert.equal(m.json().run.runId, "run-b")
})

test("?runId= for an unknown run → 404", async () => {
  const m = mockRes()
  handleRuns({ url: "/_oyren/runs?token=sekret&runId=run-nope" }, m.res, { runJobs: fakeJobs })
  await m.finished
  assert.equal(m.status, 404)
})

test("OPTIONS preflight returns 204 with CORS headers", async () => {
  const m = mockRes()
  handleRuns({ method: "OPTIONS", url: "/_oyren/runs" }, m.res, { runJobs: fakeJobs })
  await m.finished
  assert.equal(m.status, 204)
  assert.equal(m.headers["Access-Control-Allow-Origin"], "*")
  assert.ok(m.headers["Access-Control-Allow-Methods"].includes("GET"))
})
