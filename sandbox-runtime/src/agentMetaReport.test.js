const { test, beforeEach } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { collectMeta, reportMeta, __reset } = require("./agentMetaReport")
const agentMeta = require("./agentMeta")

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64")

// A workdir with two repo children (multi-repo layout) + a scripted `run` recording every call.
function twoRepos() {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-meta-"))
  fs.mkdirSync(path.join(workdir, "app", ".git"), { recursive: true })
  fs.mkdirSync(path.join(workdir, "lib", ".git"), { recursive: true })
  return workdir
}
function fakeRun(answers) {
  const calls = []
  const run = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd })
    const answer = answers[`${cmd}:${path.basename(opts.cwd)}`]
    return typeof answer === "function" ? answer() : answer || { ok: false, out: "" }
  }
  return { run, calls }
}
const envFor = (workdir, extra = {}) => ({ WORKING_DIR: workdir, OYREN_SESSION_SLUG: "sl-9", ...extra })

beforeEach(() => { __reset(); agentMeta.__reset() })

test("collectMeta gathers branch + draft-PR URL + checkpoint ref for EVERY repo, plus the turn count", async () => {
  const workdir = twoRepos()
  const { run, calls } = fakeRun({
    "git:app": { ok: true, out: "feat/x" }, "gh:app": { ok: true, out: "https://github.com/o/a/pull/3" },
    "git:lib": { ok: true, out: "main" }, "gh:lib": { ok: false, out: "" }, // no PR for lib — tolerated
  })
  agentMeta.bumpTurnCount()
  const meta = await collectMeta({ env: envFor(workdir, { AGENT_META_B64: b64({ turnCount: 2 }) }), run })
  assert.deepEqual(meta.repos, [
    { dir: "app", branch: "feat/x", prUrl: "https://github.com/o/a/pull/3", checkpointRef: "oyren/checkpoint-sl-9" },
    { dir: "lib", branch: "main", prUrl: null, checkpointRef: "oyren/checkpoint-sl-9" },
  ])
  assert.equal(meta.turnCount, 3) // stored baseline (2) + this boot's local turns (1)
  assert.ok(meta.updatedAt)
  const gh = calls.find((c) => c.cmd === "gh")
  assert.deepEqual(gh.args, ["pr", "view", "--json", "url", "-q", ".url"])
})

test("the PR URL is cached per branch (one gh call), while a missing PR is retried next collect", async () => {
  const workdir = twoRepos()
  const { run, calls } = fakeRun({
    "git:app": { ok: true, out: "feat/x" }, "gh:app": { ok: true, out: "https://github.com/o/a/pull/3" },
    "git:lib": { ok: true, out: "main" }, "gh:lib": { ok: false, out: "" },
  })
  await collectMeta({ env: envFor(workdir), run })
  await collectMeta({ env: envFor(workdir), run })
  assert.equal(calls.filter((c) => c.cmd === "gh" && c.cwd.endsWith("app")).length, 1) // cache hit
  assert.equal(calls.filter((c) => c.cmd === "gh" && c.cwd.endsWith("lib")).length, 2) // absence retried
})

test("reportMeta: idle sessions post nothing; changed meta posts the store form; unchanged skips", async () => {
  const workdir = twoRepos()
  const { run } = fakeRun({ "git:app": { ok: true, out: "main" }, "git:lib": { ok: true, out: "main" } })
  const posts = []
  const fetchImpl = async (url, opts) => { posts.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({}) } }
  const env = envFor(workdir, { ORCHESTRATOR_URL: "https://orch.example", CONTROL_TOKEN: "ct" })
  assert.equal(await reportMeta({ env, run, fetchImpl }), "idle") // no turn yet, no PR → keep the store empty
  agentMeta.bumpTurnCount()
  assert.equal(await reportMeta({ env, run, fetchImpl }), "sent")
  assert.equal(await reportMeta({ env, run, fetchImpl }), "unchanged") // deep-compare: updatedAt alone is not a change
  const stores = posts.filter((p) => p.body.meta !== undefined) // the baseline load posts the fetch form once
  assert.equal(stores.length, 1)
  assert.equal(stores[0].url, "https://orch.example/sandbox/agent-meta")
  assert.equal(stores[0].body.appSlug, "sl-9")
  assert.equal(stores[0].body.controlToken, "ct")
  assert.equal(stores[0].body.meta.turnCount, 1)
  assert.equal(stores[0].body.meta.repos.length, 2)
})

test("an agent that can't authenticate reports IMMEDIATELY, with no turn and no PR", async () => {
  // The overnight failure was invisible precisely because an unauthenticated agent produces no turn
  // and no PR — the two things the report used to wait for. A known auth verdict now posts on its
  // own, so the Apps tab can show the session as failed before anyone opens it.
  const workdir = twoRepos()
  const { run } = fakeRun({ "git:app": { ok: true, out: "main" }, "git:lib": { ok: true, out: "main" } })
  const posts = []
  const fetchImpl = async (url, opts) => { posts.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({}) } }
  const env = envFor(workdir, { ORCHESTRATOR_URL: "https://orch.example", CONTROL_TOKEN: "ct" })
  const probe = async () => ({ agentReady: false, reason: "auth_failed" })

  assert.equal(await reportMeta({ env, run, fetchImpl, probe }), "sent")
  const stored = posts.filter((p) => p.meta !== undefined)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].meta.agentReady, false)
  assert.equal(stored[0].meta.agentReadyReason, "auth_failed")
  assert.equal(stored[0].meta.turnCount, 0) // still idle — the verdict is what's worth sending
})

test("an `unknown` verdict keeps the old idle behaviour (never invent a status)", async () => {
  const workdir = twoRepos()
  const { run } = fakeRun({ "git:app": { ok: true, out: "main" }, "git:lib": { ok: true, out: "main" } })
  const fetchImpl = async () => ({ ok: true, json: async () => ({}) })
  const env = envFor(workdir, { ORCHESTRATOR_URL: "https://orch.example", CONTROL_TOKEN: "ct" })
  const probe = async () => ({ agentReady: true, reason: "unknown" })
  assert.equal(await reportMeta({ env, run, fetchImpl, probe }), "idle")
})

test("a failed POST is swallowed as a tag and retried on the next tick (last-sent not updated)", async () => {
  const workdir = twoRepos()
  const { run } = fakeRun({ "git:app": { ok: true, out: "main" }, "git:lib": { ok: true, out: "main" } })
  agentMeta.bumpTurnCount()
  const env = envFor(workdir, { ORCHESTRATOR_URL: "https://orch.example", CONTROL_TOKEN: "ct" })
  assert.equal(await reportMeta({ env, run, fetchImpl: async () => ({ ok: false }) }), "post-failed")
  assert.match(await reportMeta({ env, run, fetchImpl: async () => { throw new Error("net down") } }), /^failed: net down/)
  assert.equal(await reportMeta({ env, run, fetchImpl: async () => ({ ok: true }) }), "sent")
})

test("without the orchestrator env the report is a quiet no-op tag", async () => {
  const workdir = twoRepos()
  const { run } = fakeRun({ "git:app": { ok: true, out: "main" }, "git:lib": { ok: true, out: "main" } })
  agentMeta.bumpTurnCount()
  assert.equal(await reportMeta({ env: envFor(workdir), run, fetchImpl: async () => ({ ok: true }) }), "no-endpoint")
})
