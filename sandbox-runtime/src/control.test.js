const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { Readable } = require("stream")
const { handleControl } = require("./control")
const { readManifest } = require("./manifest")
const { Routes } = require("./routes")

const TOKEN = "secret-control-token"

function makeReq({ method = "POST", url, headers = {}, body = "" }) {
  const req = Readable.from([body])
  req.method = method
  req.url = url
  req.headers = headers
  return req
}

function makeRes() {
  return {
    statusCode: 0, headers: null, body: "", headersSent: false,
    writeHead(s, h) { this.statusCode = s; this.headers = h; this.headersSent = true; return this },
    end(b) { this.body = b || "" },
    json() { return JSON.parse(this.body || "{}") },
  }
}

function fakeSupervisor(over = {}) {
  return {
    calls: [],
    expose(port) { this.calls.push(["expose", port]); return { exposedPort: port, managed: false } },
    async start(port) { this.calls.push(["start", port]); return { state: "running", managed: true } },
    async restart() { this.calls.push(["restart"]); return over.restart || { state: "idle", managed: true } },
    async stop() { this.calls.push(["stop"]); return { state: "idle" } },
    async status() { this.calls.push(["status"]); return { state: "running", listening: true } },
  }
}

const auth = { "x-oyren-control-token": TOKEN }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-control-"))

test("rejects a missing token with 401", async () => {
  const res = makeRes()
  await handleControl(makeReq({ url: "/_oyren/control/status" }), res, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
  assert.equal(res.statusCode, 401)
})

test("rejects a wrong token with 401", async () => {
  const res = makeRes()
  const req = makeReq({ url: "/_oyren/control/status", headers: { "x-oyren-control-token": "nope" } })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
  assert.equal(res.statusCode, 401)
})

test("expose writes the port to oyren.yml and calls the supervisor", async () => {
  const res = makeRes()
  const dir = tmp()
  const sup = fakeSupervisor()
  const req = makeReq({ url: "/_oyren/control/expose", headers: auth, body: JSON.stringify({ port: 3000 }) })
  await handleControl(req, res, { supervisor: sup, workdir: dir, token: TOKEN })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(sup.calls[0], ["expose", 3000])
  assert.equal(readManifest(dir).port, 3000)
})

test("expose without a port is a 400", async () => {
  const res = makeRes()
  const req = makeReq({ url: "/_oyren/control/expose", headers: auth, body: "{}" })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
  assert.equal(res.statusCode, 400)
})

test("restart on an unmanaged app surfaces as 409", async () => {
  const res = makeRes()
  const sup = fakeSupervisor({ restart: { managed: false, error: "not managed" } })
  const req = makeReq({ url: "/_oyren/control/restart", headers: auth })
  await handleControl(req, res, { supervisor: sup, workdir: tmp(), token: TOKEN })
  assert.equal(res.statusCode, 409)
})

test("status returns the supervisor status as JSON", async () => {
  const res = makeRes()
  const req = makeReq({ method: "GET", url: "/_oyren/control/status", headers: auth })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().listening, true)
})

test("run without a command is a 400", async () => {
  const res = makeRes()
  const req = makeReq({ url: "/_oyren/control/run", headers: auth, body: "{}" })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
  assert.equal(res.statusCode, 400)
})

test("run executes the command via the runner and returns its captured output", async () => {
  const res = makeRes()
  const dir = tmp()
  const calls = []
  const runner = async (command, opts) => {
    calls.push([command, opts])
    return { stdout: "ok\n", stderr: "", exitCode: 0, timedOut: false }
  }
  const req = makeReq({
    url: "/_oyren/control/run",
    headers: auth,
    body: JSON.stringify({ command: "pnpm test", cwd: "repo", timeoutMs: 5000 }),
  })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: dir, token: TOKEN, runner })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().exitCode, 0)
  assert.equal(res.json().stdout, "ok\n")
  assert.equal(calls[0][0], "pnpm test")
  assert.equal(calls[0][1].cwd, path.join(dir, "repo"))
  assert.equal(calls[0][1].timeoutMs, 5000)
})

test("run defaults cwd to the workdir and passes no timeout when unset", async () => {
  const res = makeRes()
  const dir = tmp()
  let seen
  const runner = async (_command, opts) => { seen = opts; return { stdout: "", stderr: "", exitCode: 0, timedOut: false } }
  const req = makeReq({ url: "/_oyren/control/run", headers: auth, body: JSON.stringify({ script: "ls" }) })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: dir, token: TOKEN, runner })
  assert.equal(res.statusCode, 200)
  assert.equal(seen.cwd, dir)
  assert.equal(seen.timeoutMs, undefined)
})

test("run with detach:true answers { runId } immediately and run_result polls it to done", async () => {
  const { createRunJobs } = require("./runJobs")
  const dir = tmp()
  const deps = { supervisor: fakeSupervisor(), workdir: dir, token: TOKEN, jobs: createRunJobs() }
  let finish
  deps.runner = (command, opts) => new Promise((resolve) => { finish = () => resolve({ stdout: `${command} @ ${opts.cwd}\n`, stderr: "", exitCode: 0, timedOut: false }) })
  const res = makeRes()
  await handleControl(makeReq({ url: "/_oyren/control/run", headers: auth, body: JSON.stringify({ command: "pnpm build", detach: true }) }), res, deps)
  assert.equal(res.statusCode, 200)
  const { runId } = res.json()
  assert.ok(runId, "immediate { runId } — the job runs in the background")
  const running = makeRes()
  await handleControl(makeReq({ url: "/_oyren/control/run_result", headers: auth, body: JSON.stringify({ runId }) }), running, deps)
  // Running answers carry live partial output since runJobs grew onOutput streaming.
  assert.deepEqual(running.json(), { status: "running", stdout: "", stderr: "" })
  finish()
  await new Promise((r) => setImmediate(r))
  const done = makeRes()
  await handleControl(makeReq({ url: "/_oyren/control/run_result", headers: auth, body: JSON.stringify({ runId }) }), done, deps)
  assert.equal(done.statusCode, 200)
  assert.deepEqual(done.json(), { status: "done", stdout: `pnpm build @ ${dir}\n`, stderr: "", exitCode: 0, timedOut: false })
})

test("run_result: missing runId is a 400, an unknown/pruned runId answers status unknown", async () => {
  const bad = makeRes()
  await handleControl(makeReq({ url: "/_oyren/control/run_result", headers: auth, body: "{}" }), bad, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
  assert.equal(bad.statusCode, 400)
  const unknown = makeRes()
  await handleControl(makeReq({ url: "/_oyren/control/run_result", headers: auth, body: JSON.stringify({ runId: "run-gone" }) }), unknown, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
  assert.equal(unknown.statusCode, 200)
  assert.deepEqual(unknown.json(), { status: "unknown" })
})

test("detached runs over the concurrency cap are refused with an error (sync mode unaffected)", async () => {
  const { createRunJobs } = require("./runJobs")
  const deps = { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN, jobs: createRunJobs({ maxConcurrent: 1 }), runner: () => new Promise(() => {}) }
  const first = makeRes()
  await handleControl(makeReq({ url: "/_oyren/control/run", headers: auth, body: JSON.stringify({ command: "sleep 999", detach: true }) }), first, deps)
  assert.equal(first.statusCode, 200)
  const second = makeRes()
  await handleControl(makeReq({ url: "/_oyren/control/run", headers: auth, body: JSON.stringify({ command: "sleep 999", detach: true }) }), second, deps)
  assert.equal(second.statusCode, 429)
  assert.match(second.json().error, /too many concurrent detached runs/)
  const sync = makeRes()
  const syncDeps = { ...deps, runner: async () => ({ stdout: "ok", stderr: "", exitCode: 0, timedOut: false }) }
  await handleControl(makeReq({ url: "/_oyren/control/run", headers: auth, body: JSON.stringify({ command: "ls" }) }), sync, syncDeps)
  assert.equal(sync.statusCode, 200)
  assert.equal(sync.json().stdout, "ok") // sync mode keeps its exact old contract
})

test("an unknown action is a 404", async () => {
  const res = makeRes()
  const req = makeReq({ url: "/_oyren/control/frobnicate", headers: auth })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
  assert.equal(res.statusCode, 404)
})

// --- Route management ---

test("route/add creates a route and returns the list", async () => {
  const dir = tmp()
  const routes = new Routes(dir)
  const res = makeRes()
  const req = makeReq({
    url: "/_oyren/control/route/add",
    headers: auth,
    body: JSON.stringify({ prefix: "/studio", port: 3000, label: "Studio" }),
  })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: dir, token: TOKEN, routes })
  assert.equal(res.statusCode, 200)
  const data = res.json()
  assert.equal(data.routes.length, 1)
  assert.equal(data.routes[0].prefix, "/studio")
  assert.equal(data.routes[0].port, 3000)
})

test("route/add rejects missing prefix or port", async () => {
  const dir = tmp()
  const routes = new Routes(dir)
  const res = makeRes()
  const req = makeReq({
    url: "/_oyren/control/route/add",
    headers: auth,
    body: JSON.stringify({ prefix: "/x" }),
  })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: dir, token: TOKEN, routes })
  assert.equal(res.statusCode, 400)
})

test("route/remove removes a route", async () => {
  const dir = tmp()
  const routes = new Routes(dir)
  routes.add("/studio", 3000)
  const res = makeRes()
  const req = makeReq({
    url: "/_oyren/control/route/remove",
    headers: auth,
    body: JSON.stringify({ prefix: "/studio" }),
  })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: dir, token: TOKEN, routes })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().removed, true)
  assert.equal(res.json().routes.length, 0)
})

test("route/remove returns 404 for unknown prefix", async () => {
  const dir = tmp()
  const routes = new Routes(dir)
  const res = makeRes()
  const req = makeReq({
    url: "/_oyren/control/route/remove",
    headers: auth,
    body: JSON.stringify({ prefix: "/nope" }),
  })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: dir, token: TOKEN, routes })
  assert.equal(res.statusCode, 404)
})

test("route/list returns all configured routes", async () => {
  const dir = tmp()
  const routes = new Routes(dir)
  routes.add("/a", 3000, "A")
  routes.add("/b", 3001, "B")
  const res = makeRes()
  const req = makeReq({ method: "GET", url: "/_oyren/control/route/list", headers: auth })
  await handleControl(req, res, { supervisor: fakeSupervisor(), workdir: dir, token: TOKEN, routes })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().routes.length, 2)
})
test("status carries the image summary and `image` returns the whole manifest", async () => {
  const file = path.join(tmp(), "image-manifest.json")
  fs.writeFileSync(file, JSON.stringify({ version: "2026-08-25-1838", family: "base", builtAt: "2026-08-25T18:38:00Z", composerSha: "342436e", components: { runtime: "t-1", claude: "2.1.235" } }))
  process.env.OYREN_IMAGE_MANIFEST = file
  try {
    const status = makeRes()
    await handleControl(makeReq({ method: "GET", url: "/_oyren/control/status", headers: auth }), status, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
    assert.equal(status.json().listening, true)
    assert.deepStrictEqual(status.json().image, { version: "2026-08-25-1838", family: "base", builtAt: "2026-08-25T18:38:00Z", composerSha: "342436e", runtime: "t-1" })
    const image = makeRes()
    await handleControl(makeReq({ method: "GET", url: "/_oyren/control/image", headers: auth }), image, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
    assert.equal(image.statusCode, 200)
    assert.equal(image.json().components.claude, "2.1.235")
  } finally {
    delete process.env.OYREN_IMAGE_MANIFEST
  }
})

test("`image` is a 404 on an image that predates manifests, and status still answers", async () => {
  process.env.OYREN_IMAGE_MANIFEST = path.join(tmp(), "missing.json")
  try {
    const image = makeRes()
    await handleControl(makeReq({ method: "GET", url: "/_oyren/control/image", headers: auth }), image, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
    assert.equal(image.statusCode, 404)
    const status = makeRes()
    await handleControl(makeReq({ method: "GET", url: "/_oyren/control/status", headers: auth }), status, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
    assert.equal(status.statusCode, 200)
    assert.equal(status.json().image, null)
  } finally {
    delete process.env.OYREN_IMAGE_MANIFEST
  }
})

test("update/status pairs the image with the updater's status file, null when none ran", async () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, "image-manifest.json"), JSON.stringify({ version: "2026-08-20-1410", family: "base", components: { runtime: "t-1" } }))
  fs.writeFileSync(path.join(dir, "update-status.json"), JSON.stringify({ state: "running", step: "applying:claude", from: "2026-08-20-1410", to: "2026-08-25-1838" }))
  process.env.OYREN_IMAGE_MANIFEST = path.join(dir, "image-manifest.json")
  process.env.OYREN_UPDATE_STATUS = path.join(dir, "update-status.json")
  try {
    const res = makeRes()
    await handleControl(makeReq({ method: "GET", url: "/_oyren/control/update/status", headers: auth }), res, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
    assert.equal(res.statusCode, 200)
    assert.equal(res.json().image.version, "2026-08-20-1410")
    assert.equal(res.json().update.step, "applying:claude")
    process.env.OYREN_UPDATE_STATUS = path.join(dir, "missing.json")
    const none = makeRes()
    await handleControl(makeReq({ method: "GET", url: "/_oyren/control/update/status", headers: auth }), none, { supervisor: fakeSupervisor(), workdir: tmp(), token: TOKEN })
    assert.equal(none.json().update, null)
  } finally {
    delete process.env.OYREN_IMAGE_MANIFEST
    delete process.env.OYREN_UPDATE_STATUS
  }
})
