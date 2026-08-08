const { test } = require("node:test")
const assert = require("node:assert")
const path = require("path")
const http = require("http")
const { spawnSync, spawn } = require("child_process")

const HELPER = path.join(__dirname, "git-credential-oyren.sh")
const GITHUB_REQ = "protocol=https\nhost=github.com\n\n"

// Run the helper as git would: `git-credential-oyren <op>` with the request on stdin. Invoked via bash so
// the test never depends on the file's executable bit. PATH is kept (curl/sed/printf must resolve) but
// GITHUB_TOKEN / ORCHESTRATOR_URL etc. are supplied per case so each test controls exactly what it sees.
function run(op, input, env = {}) {
  const r = spawnSync("bash", [HELPER, op], { input, env: { PATH: process.env.PATH, ...env }, encoding: "utf8" })
  return { out: r.stdout, code: r.status }
}

// Async variant — REQUIRED when the helper calls an in-process HTTP server: spawnSync would block the
// event loop and deadlock the server (curl would then hit its --max-time and wrongly fall back).
function runAsync(op, input, env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [HELPER, op], { env: { PATH: process.env.PATH, ...env } })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    child.on("close", (code) => resolve({ out, code }))
    child.stdin.end(input)
  })
}

// Start a throwaway HTTP server that plays the orchestrator's /sandbox/git-token endpoint.
function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler)
    srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }))
  })
}

test("get: github.com https + env token ⇒ emits x-access-token + the token", () => {
  const { out, code } = run("get", GITHUB_REQ, { GITHUB_TOKEN: "ghs_FAKE123" })
  assert.equal(code, 0)
  assert.match(out, /^username=x-access-token$/m)
  assert.match(out, /^password=ghs_FAKE123$/m)
})

test("get: no token source at all ⇒ no credentials (helper stays a no-op, git falls back)", () => {
  const { out, code } = run("get", GITHUB_REQ, {})
  assert.equal(code, 0)
  assert.equal(out.trim(), "")
})

// Security boundary: the token must NEVER be handed to any host but github.com.
test("get: non-github host ⇒ never leaks the token", () => {
  for (const host of ["gitlab.com", "evil.com", "github.com.evil.com"]) {
    const req = `protocol=https\nhost=${host}\n\n`
    const { out } = run("get", req, { GITHUB_TOKEN: "ghs_FAKE123" })
    assert.equal(out.trim(), "", `leaked to ${host}`)
  }
})

test("get: non-https protocol on github.com ⇒ never leaks the token", () => {
  const { out } = run("get", "protocol=http\nhost=github.com\n\n", { GITHUB_TOKEN: "ghs_FAKE123" })
  assert.equal(out.trim(), "")
})

test("store/erase ⇒ no-op, no output", () => {
  for (const op of ["store", "erase"]) {
    const { out, code } = run(op, GITHUB_REQ, { GITHUB_TOKEN: "ghs_FAKE123" })
    assert.equal(code, 0)
    assert.equal(out.trim(), "")
  }
})

// Layer 2: a fresh token from the orchestrator is preferred over the (possibly-stale) env token.
test("get: orchestrator returns a token ⇒ uses it over the env token", async () => {
  const srv = await serve((_req, res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ token: "ghs_FROM_ORCH" }))
  })
  try {
    const { out } = await runAsync("get", GITHUB_REQ, {
      ORCHESTRATOR_URL: srv.url, OYREN_SESSION_SLUG: "sb-x", CONTROL_TOKEN: "ctl", GITHUB_TOKEN: "ghs_ENV",
    })
    assert.match(out, /^password=ghs_FROM_ORCH$/m)
  } finally {
    srv.close()
  }
})

test("get: orchestrator unreachable ⇒ falls back to the env token", () => {
  const { out } = run("get", GITHUB_REQ, {
    ORCHESTRATOR_URL: "http://127.0.0.1:1", OYREN_SESSION_SLUG: "sb-x", CONTROL_TOKEN: "ctl", GITHUB_TOKEN: "ghs_ENV",
  })
  assert.match(out, /^password=ghs_ENV$/m)
})

test("get: orchestrator returns no token (e.g. 403) ⇒ falls back to the env token", async () => {
  const srv = await serve((_req, res) => {
    res.statusCode = 403
    res.end(JSON.stringify({ error: "Invalid control token" }))
  })
  try {
    const { out } = await runAsync("get", GITHUB_REQ, {
      ORCHESTRATOR_URL: srv.url, OYREN_SESSION_SLUG: "sb-x", CONTROL_TOKEN: "bad", GITHUB_TOKEN: "ghs_ENV",
    })
    assert.match(out, /^password=ghs_ENV$/m)
  } finally {
    srv.close()
  }
})
