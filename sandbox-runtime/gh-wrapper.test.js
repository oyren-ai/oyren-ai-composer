const { test } = require("node:test")
const assert = require("node:assert")
const path = require("path")
const fs = require("fs")
const os = require("os")
const http = require("http")
const { spawnSync, spawn, execFileSync } = require("child_process")

const WRAPPER = path.join(__dirname, "gh-wrapper.sh")

// The real /usr/bin/gh is hardcoded in the wrapper; GH_WRAPPER_REAL_GH (test-only) redirects the final
// exec to this stub instead, which reports exactly what the wrapper decided — argv plus the GH_TOKEN /
// GITHUB_TOKEN it was handed — without ever touching the network or the real gh binary.
function makeStubGh(dir) {
  const stub = path.join(dir, "stub-gh.sh")
  fs.writeFileSync(
    stub,
    "#!/bin/sh\nprintf 'ARGV:%s\\n' \"$*\"\nprintf 'GH_TOKEN:%s\\n' \"$GH_TOKEN\"\nprintf 'GITHUB_TOKEN:%s\\n' \"$GITHUB_TOKEN\"\n",
    { mode: 0o755 },
  )
  return stub
}

function makeRepo(remoteUrl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-gh-wrapper-repo-"))
  execFileSync("git", ["init", "-q", dir])
  if (remoteUrl) execFileSync("git", ["-C", dir, "remote", "add", "origin", remoteUrl])
  return dir
}

function parse(out) {
  return {
    argv: /ARGV:(.*)/.exec(out)?.[1] ?? "",
    ghToken: /GH_TOKEN:(.*)/.exec(out)?.[1] ?? "",
    githubToken: /GITHUB_TOKEN:(.*)/.exec(out)?.[1] ?? "",
  }
}

// Run the wrapper as `gh` would be invoked: `gh-wrapper.sh <args...>` in `cwd`, with a fresh stub gh
// on GH_WRAPPER_REAL_GH per call. PATH is kept (curl/sed/git must resolve); every other env var is
// supplied per case so each test controls exactly what the wrapper sees.
function run(env = {}, cwd = os.tmpdir(), args = ["pr", "view"]) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-gh-wrapper-stub-"))
  const stub = makeStubGh(tmp)
  const r = spawnSync("bash", [WRAPPER, ...args], {
    cwd,
    env: { PATH: process.env.PATH, GH_WRAPPER_REAL_GH: stub, ...env },
    encoding: "utf8",
  })
  fs.rmSync(tmp, { recursive: true, force: true })
  return parse(r.stdout)
}

// Async variant — REQUIRED when the wrapper calls an in-process HTTP server: spawnSync would block the
// event loop and deadlock the server (curl would then hit its --max-time and wrongly fall back).
function runAsync(env = {}, cwd = os.tmpdir(), args = ["pr", "view"]) {
  return new Promise((resolve) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-gh-wrapper-stub-"))
    const stub = makeStubGh(tmp)
    const child = spawn("bash", [WRAPPER, ...args], { cwd, env: { PATH: process.env.PATH, GH_WRAPPER_REAL_GH: stub, ...env } })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    child.on("close", () => {
      fs.rmSync(tmp, { recursive: true, force: true })
      resolve(parse(out))
    })
  })
}

// Start a throwaway HTTP server that plays the orchestrator's /sandbox/git-token endpoint, capturing
// the request body it received so tests can assert on repoFullName inclusion/omission.
function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler)
    srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }))
  })
}
function captureBody(respond) {
  let body = ""
  const bodyOf = () => body
  const handler = (req, res) => {
    req.on("data", (d) => (body += d))
    req.on("end", () => respond(res))
  }
  return { handler, bodyOf }
}

test("forwards argv to the real gh binary unchanged", () => {
  const { argv } = run({ GITHUB_TOKEN: "ghs_LAUNCH" }, os.tmpdir(), ["pr", "view", "42"])
  assert.equal(argv, "pr view 42")
})

test("no token source at all ⇒ gh runs with no GH_TOKEN/GITHUB_TOKEN (untouched, git falls back)", () => {
  const { ghToken, githubToken } = run({})
  assert.equal(ghToken, "")
  assert.equal(githubToken, "")
})

test("step 3: launch GITHUB_TOKEN is used when the orchestrator isn't configured and REPO_CLONE_TOKENS doesn't match", () => {
  const { ghToken, githubToken } = run({ GITHUB_TOKEN: "ghs_LAUNCH" })
  assert.equal(ghToken, "ghs_LAUNCH")
  assert.equal(githubToken, "ghs_LAUNCH")
})

test("step 2: orchestrator unreachable ⇒ falls back to the REPO_CLONE_TOKENS entry matching $PWD's origin repo", () => {
  const repo = makeRepo("git@github.com:oyren-ai/oyren-ai-composer.git")
  try {
    const { ghToken, githubToken } = run(
      {
        ORCHESTRATOR_URL: "http://127.0.0.1:1",
        OYREN_SESSION_SLUG: "sb-x",
        CONTROL_TOKEN: "ctl",
        REPO_FULL_NAMES: "oyren-ai/other-repo,oyren-ai/oyren-ai-composer",
        REPO_CLONE_TOKENS: "ghs_OTHER,ghs_CLONE_MATCH",
        GITHUB_TOKEN: "ghs_LAUNCH",
      },
      repo,
    )
    assert.equal(ghToken, "ghs_CLONE_MATCH")
    assert.equal(githubToken, "ghs_CLONE_MATCH")
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test("step 2: no resolvable origin (not a git repo) ⇒ REPO_CLONE_TOKENS is skipped, falls through to launch GITHUB_TOKEN", () => {
  const { ghToken } = run({
    ORCHESTRATOR_URL: "http://127.0.0.1:1",
    OYREN_SESSION_SLUG: "sb-x",
    CONTROL_TOKEN: "ctl",
    REPO_FULL_NAMES: "oyren-ai/oyren-ai-composer",
    REPO_CLONE_TOKENS: "ghs_CLONE_MATCH",
    GITHUB_TOKEN: "ghs_LAUNCH",
  })
  assert.equal(ghToken, "ghs_LAUNCH")
})

// Step 1, the fix under test: the orchestrator mint call must be scoped to the repo in $PWD.
test("step 1: repoFullName is included in the orchestrator request when $PWD is inside a repo with a resolvable origin", async () => {
  const repo = makeRepo("https://github.com/oyren-ai/oyren-ai-composer.git")
  const { handler, bodyOf } = captureBody((res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ token: "ghs_FROM_ORCH" }))
  })
  const srv = await serve(handler)
  try {
    const { ghToken, githubToken } = await runAsync(
      {
        ORCHESTRATOR_URL: srv.url,
        OYREN_SESSION_SLUG: "sb-x",
        CONTROL_TOKEN: "ctl",
        REPO_FULL_NAMES: "oyren-ai/oyren-ai-composer",
        REPO_CLONE_TOKENS: "ghs_SHOULD_NOT_BE_USED",
        GITHUB_TOKEN: "ghs_SHOULD_NOT_BE_USED_EITHER",
      },
      repo,
    )
    assert.equal(ghToken, "ghs_FROM_ORCH") // orchestrator wins over steps 2 and 3
    assert.equal(githubToken, "ghs_FROM_ORCH")
    assert.match(bodyOf(), /"repoFullName":"oyren-ai\/oyren-ai-composer"/)
  } finally {
    srv.close()
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test("step 1: repoFullName is omitted from the orchestrator request when $PWD isn't inside a git repo (unchanged behavior)", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-gh-wrapper-noreo-"))
  const { handler, bodyOf } = captureBody((res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ token: "ghs_FROM_ORCH" }))
  })
  const srv = await serve(handler)
  try {
    const { ghToken } = await runAsync(
      { ORCHESTRATOR_URL: srv.url, OYREN_SESSION_SLUG: "sb-x", CONTROL_TOKEN: "ctl" },
      plain,
    )
    assert.equal(ghToken, "ghs_FROM_ORCH")
    assert.ok(!bodyOf().includes("repoFullName"), `expected no repoFullName, got: ${bodyOf()}`)
  } finally {
    srv.close()
    fs.rmSync(plain, { recursive: true, force: true })
  }
})

test("step 1: orchestrator returns no token (e.g. 403) ⇒ falls back to REPO_CLONE_TOKENS", async () => {
  const repo = makeRepo("https://github.com/oyren-ai/oyren-ai-composer.git")
  const srv = await serve((_req, res) => {
    res.statusCode = 403
    res.end(JSON.stringify({ error: "Invalid control token" }))
  })
  try {
    const { ghToken } = await runAsync(
      {
        ORCHESTRATOR_URL: srv.url,
        OYREN_SESSION_SLUG: "sb-x",
        CONTROL_TOKEN: "bad",
        REPO_FULL_NAMES: "oyren-ai/oyren-ai-composer",
        REPO_CLONE_TOKENS: "ghs_CLONE_MATCH",
        GITHUB_TOKEN: "ghs_LAUNCH",
      },
      repo,
    )
    assert.equal(ghToken, "ghs_CLONE_MATCH")
  } finally {
    srv.close()
    fs.rmSync(repo, { recursive: true, force: true })
  }
})
