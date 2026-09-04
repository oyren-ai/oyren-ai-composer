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

// Step 0: a caller-exported GH_TOKEN wins outright — the wrapper must not mint over it.
test("step 0: caller-exported GH_TOKEN passes through untouched and no mint request is made", async () => {
  const { handler, bodyOf } = captureBody((res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ token: "ghs_SHOULD_NOT_BE_MINTED" }))
  })
  const srv = await serve(handler)
  try {
    const { ghToken, githubToken } = await runAsync({
      GH_TOKEN: "ghp_CALLERS_OWN",
      GITHUB_TOKEN: "ghs_LAUNCH",
      ORCHESTRATOR_URL: srv.url,
      OYREN_SESSION_SLUG: "sb-x",
      CONTROL_TOKEN: "ctl",
    })
    assert.equal(ghToken, "ghp_CALLERS_OWN")
    assert.equal(githubToken, "ghs_LAUNCH") // launch var left alone, not overwritten to match
    assert.equal(bodyOf(), "", "the wrapper must not call the orchestrator when GH_TOKEN is caller-set")
  } finally {
    srv.close()
  }
})

test("step 0: caller GH_TOKEN passthrough still forwards argv unchanged", () => {
  const { argv, ghToken } = run({ GH_TOKEN: "ghp_CALLERS_OWN" }, os.tmpdir(), ["api", "user"])
  assert.equal(argv, "api user")
  assert.equal(ghToken, "ghp_CALLERS_OWN")
})

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

// Target resolution: --repo/-R flag > GH_REPO env > cwd origin remote, mirroring gh itself.
function mintServer() {
  const { handler, bodyOf } = captureBody((res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ token: "ghs_FROM_ORCH" }))
  })
  return serve(handler).then((srv) => ({ srv, bodyOf }))
}
const ORCH_ENV = { OYREN_SESSION_SLUG: "sb-x", CONTROL_TOKEN: "ctl" }

test("target: --repo flag beats the cwd origin remote", async () => {
  const repo = makeRepo("git@github.com:oyren-ai/oyren-ai-composer.git")
  const { srv, bodyOf } = await mintServer()
  try {
    await runAsync({ ORCHESTRATOR_URL: srv.url, ...ORCH_ENV }, repo, ["pr", "view", "--repo", "oyren-ai/oyren-ai-next"])
    assert.match(bodyOf(), /"repoFullName":"oyren-ai\/oyren-ai-next"/)
  } finally {
    srv.close()
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test("target: -R short flag and --repo=value spellings both resolve, last occurrence wins", async () => {
  const { srv, bodyOf } = await mintServer()
  try {
    await runAsync({ ORCHESTRATOR_URL: srv.url, ...ORCH_ENV }, os.tmpdir(), [
      "pr", "view", "--repo=oyren-ai/first", "-R", "oyren-ai/oyren-ai-sales",
    ])
    assert.match(bodyOf(), /"repoFullName":"oyren-ai\/oyren-ai-sales"/)
  } finally {
    srv.close()
  }
})

test("target: full-URL --repo value is normalized to owner/repo", async () => {
  const { srv, bodyOf } = await mintServer()
  try {
    await runAsync({ ORCHESTRATOR_URL: srv.url, ...ORCH_ENV }, os.tmpdir(), [
      "api", "x", "-R", "https://github.com/oyren-ai/oyren-ai-next.git",
    ])
    assert.match(bodyOf(), /"repoFullName":"oyren-ai\/oyren-ai-next"/)
  } finally {
    srv.close()
  }
})

test("target: GH_REPO env is used when no flag is present, and beats the cwd remote", async () => {
  const repo = makeRepo("https://github.com/oyren-ai/oyren-ai-composer.git")
  const { srv, bodyOf } = await mintServer()
  try {
    await runAsync({ ORCHESTRATOR_URL: srv.url, ...ORCH_ENV, GH_REPO: "oyren-ai/oyren-ai-sales" }, repo)
    assert.match(bodyOf(), /"repoFullName":"oyren-ai\/oyren-ai-sales"/)
  } finally {
    srv.close()
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test("target: --repo flag beats GH_REPO", async () => {
  const { srv, bodyOf } = await mintServer()
  try {
    await runAsync({ ORCHESTRATOR_URL: srv.url, ...ORCH_ENV, GH_REPO: "oyren-ai/from-env" }, os.tmpdir(), [
      "pr", "view", "-Royren-ai/from-flag",
    ])
    assert.match(bodyOf(), /"repoFullName":"oyren-ai\/from-flag"/)
  } finally {
    srv.close()
  }
})

test("target: a repo name with JSON-hostile characters never reaches the mint body — mint is unscoped", async () => {
  const { srv, bodyOf } = await mintServer()
  try {
    await runAsync({ ORCHESTRATOR_URL: srv.url, ...ORCH_ENV }, os.tmpdir(), [
      "pr", "view", "-R", 'oyren-ai/we"ird\\repo',
    ])
    assert.ok(!bodyOf().includes("repoFullName"), `expected no repoFullName, got: ${bodyOf()}`)
    assert.ok(bodyOf().length > 0, "the mint request itself still goes out, just unscoped")
  } finally {
    srv.close()
  }
})

test("target: a non-github.com --repo does NOT fall through to the cwd repo — mint is unscoped", async () => {
  const repo = makeRepo("https://github.com/oyren-ai/oyren-ai-composer.git")
  const { srv, bodyOf } = await mintServer()
  try {
    await runAsync({ ORCHESTRATOR_URL: srv.url, ...ORCH_ENV }, repo, ["pr", "view", "-R", "ghe.corp.example/owner/repo"])
    assert.ok(!bodyOf().includes("repoFullName"), `expected no repoFullName, got: ${bodyOf()}`)
  } finally {
    srv.close()
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test("target: --repo after a bare -- is ignored (cwd remote wins)", async () => {
  const repo = makeRepo("https://github.com/oyren-ai/oyren-ai-composer.git")
  const { srv, bodyOf } = await mintServer()
  try {
    await runAsync({ ORCHESTRATOR_URL: srv.url, ...ORCH_ENV }, repo, ["some", "cmd", "--", "--repo", "oyren-ai/not-a-target"])
    assert.match(bodyOf(), /"repoFullName":"oyren-ai\/oyren-ai-composer"/)
  } finally {
    srv.close()
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test("step 2: REPO_CLONE_TOKENS is matched by the --repo target even outside any git repo", () => {
  const { ghToken } = run(
    {
      REPO_FULL_NAMES: "oyren-ai/oyren-ai-composer,oyren-ai/oyren-ai-next",
      REPO_CLONE_TOKENS: "ghs_COMPOSER,ghs_NEXT",
      GITHUB_TOKEN: "ghs_LAUNCH",
    },
    os.tmpdir(),
    ["pr", "view", "--repo", "oyren-ai/oyren-ai-next"],
  )
  assert.equal(ghToken, "ghs_NEXT")
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
