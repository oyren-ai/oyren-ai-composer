const { test, beforeEach } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { checkpointRef, checkpointOnce, tickOnce, start, stop } = require("./gitCheckpoint")

const repoDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-ckpt-")); fs.mkdirSync(path.join(dir, ".git")); return dir }
const envFor = (workdir) => ({ WORKING_DIR: workdir, OYREN_SESSION_SLUG: "my-slug" })
const EXCLUDES = [":(exclude)CLAUDE.md", ":(exclude)GEMINI.md", ":(exclude)QWEN.md", ":(exclude)AGENTS.md"]

// A scripted `git` exec: answers by subcommand key (object or function); records every call.
function fakeExec(answers) {
  const calls = []
  const exec = async (args, opts) => {
    calls.push({ args, opts })
    const a = answers[args[0]]
    const answer = typeof a === "function" ? a(args, opts) : a
    return answer || { ok: false, out: "" }
  }
  return { exec, calls }
}
const DIRTY = {
  remote: { ok: true, out: "https://github.com/o/r.git" },
  "rev-parse": { ok: true, out: "headsha" },
  status: { ok: true, out: " M file.js" },
  "read-tree": { ok: true, out: "" },
  add: { ok: true, out: "" },
  "ls-tree": { ok: true, out: "" }, // context files untracked at HEAD → repair force-removes them
  "update-index": { ok: true, out: "" },
  "write-tree": { ok: true, out: "treesha" },
  "commit-tree": { ok: true, out: "commitsha1234" },
  push: { ok: true, out: "" },
}

beforeEach(() => stop()) // clears the per-boot lastHead/lastTree memory between cases

test("checkpointRef prefers the session slug and falls back to the uuid", () => {
  assert.equal(checkpointRef({ OYREN_SESSION_SLUG: "s1", OYREN_SESSION_UUID: "u1" }), "oyren/checkpoint-s1")
  assert.equal(checkpointRef({ OYREN_SESSION_UUID: "u1" }), "oyren/checkpoint-u1")
})

test("dirty worktree → HEAD-seeded scratch-index snapshot force-pushed, seeded context files excluded", async () => {
  const { exec, calls } = fakeExec(DIRTY)
  const [{ outcome }] = await checkpointOnce({ env: envFor(repoDir()), exec })
  assert.equal(outcome, "pushed commitsha123") // sha shortened to 12 chars in the log tag
  const status = calls.find((c) => c.args[0] === "status")
  assert.deepEqual(status.args.slice(2), ["--", ".", ...EXCLUDES]) // seeded files never count as dirt
  const readTree = calls.find((c) => c.args[0] === "read-tree")
  assert.deepEqual(readTree.args, ["read-tree", "headsha"]) // scratch index seeded from HEAD
  assert.ok(readTree.opts.env.GIT_INDEX_FILE, "…in a scratch index, never the agent's real one")
  const add = calls.find((c) => c.args[0] === "add")
  assert.deepEqual(add.args, ["add", "-A", "--", "."]) // NO :(exclude) — naming a gitignored context file there exits 1
  assert.equal(add.opts.env.GIT_INDEX_FILE, readTree.opts.env.GIT_INDEX_FILE)
  const repairs = calls.filter((c) => c.args[0] === "update-index" && c.args[1] === "--force-remove")
  assert.deepEqual(repairs.map((c) => c.args[3]), ["CLAUDE.md", "GEMINI.md", "QWEN.md", "AGENTS.md"]) // untracked-at-HEAD context entries repaired out
  const commit = calls.find((c) => c.args[0] === "commit-tree")
  assert.deepEqual(commit.args.slice(0, 4), ["commit-tree", "treesha", "-p", "headsha"])
  assert.match(commit.args[5], /^oyren\.ai checkpoint \d{4}-/)
  assert.equal(commit.opts.env.GIT_AUTHOR_EMAIL, "contact@oyren.ai")
  const push = calls.find((c) => c.args[0] === "push")
  assert.deepEqual(push.args, ["push", "-f", "origin", "commitsha1234:refs/tags/oyren/checkpoint-my-slug"])
})

test("unpushed commit on a branch WITHOUT an upstream is checkpointed (no rev-list/@{upstream})", async () => {
  const { exec, calls } = fakeExec({ remote: { ok: true, out: "u" }, "rev-parse": (args) => ({ ok: true, out: args[1] === "HEAD" ? "headsha" : "tree-of-head" }), status: { ok: true, out: "" }, push: { ok: true, out: "" } })
  const env = envFor(repoDir())
  const [{ outcome }] = await checkpointOnce({ env, exec })
  assert.equal(outcome, "pushed headsha") // HEAD itself — no temp commit
  assert.ok(!calls.some((c) => c.args[0] === "rev-list"), "never depends on an upstream existing")
  assert.ok(!calls.some((c) => c.args[0] === "commit-tree"))
  assert.equal(calls.find((c) => c.args[0] === "push").args[3], "headsha:refs/tags/oyren/checkpoint-my-slug")
  // second pass, same HEAD + still clean → nothing new to save
  assert.equal((await checkpointOnce({ env, exec }))[0].outcome, "clean")
  // a new local commit moves HEAD → checkpointed again
  const moved = fakeExec({ remote: { ok: true, out: "u" }, "rev-parse": (args) => ({ ok: true, out: args[1] === "HEAD" ? "newhead" : "tree-2" }), status: { ok: true, out: "" }, push: { ok: true, out: "" } })
  assert.equal((await checkpointOnce({ env, exec: moved.exec }))[0].outcome, "pushed newhead")
})

test("identical snapshot content skips the push (tree hash unchanged) until real edits arrive", async () => {
  const { exec, calls } = fakeExec(DIRTY)
  const env = envFor(repoDir())
  assert.equal((await checkpointOnce({ env, exec }))[0].outcome, "pushed commitsha123")
  assert.equal((await checkpointOnce({ env, exec }))[0].outcome, "unchanged") // same tree → no new timestamped force-push
  assert.equal(calls.filter((c) => c.args[0] === "push").length, 1)
  const edited = fakeExec({ ...DIRTY, "write-tree": { ok: true, out: "treesha-2" }, "commit-tree": { ok: true, out: "commitsha5678" } })
  assert.equal((await checkpointOnce({ env, exec: edited.exec }))[0].outcome, "pushed commitsha567")
})

// --- Context files (CLAUDE.md & co.): marker-stripped staging, never wholesale exclusion ---
const MARKED = "<!-- oyren:agent-context -->\npersona\n<!-- /oyren:agent-context -->\n<!-- oyren:runtime-guidance -->\nrules\n<!-- /oyren:runtime-guidance -->\n"
const CLEAN_STATUS = { status: { ok: true, out: "" }, "ls-files": { ok: true, out: "" } }
const STAGE = { "hash-object": { ok: true, out: "blobsha" }, "update-index": { ok: true, out: "" } }

test("a seeded-only context file is NOT dirt — no snapshot, and .git/info/exclude is never touched", async () => {
  const dir = repoDir()
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), MARKED)
  const { exec, calls } = fakeExec({ remote: { ok: true, out: "u" }, "rev-parse": (args) => ({ ok: true, out: args[1] === "HEAD" ? "headsha" : "tree1" }), ...CLEAN_STATUS, push: { ok: true, out: "" } })
  const env = envFor(dir)
  assert.equal((await checkpointOnce({ env, exec }))[0].outcome, "pushed headsha") // HEAD itself — no snapshot commit
  assert.equal((await checkpointOnce({ env, exec }))[0].outcome, "clean")
  assert.ok(!calls.some((c) => c.args[0] === "commit-tree"), "marker-only content never produced a snapshot")
  assert.ok(!fs.existsSync(path.join(dir, ".git", "info", "exclude")), "nothing anchored in info/exclude")
})

test("seeded file + agent-added content → the STRIPPED content is staged (markers never leak)", async () => {
  const dir = repoDir()
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), `${MARKED}\nAgent notes: deploy steps.\n`)
  const { exec, calls } = fakeExec({ ...DIRTY, ...CLEAN_STATUS, ...STAGE })
  assert.equal((await checkpointOnce({ env: envFor(dir), exec }))[0].outcome, "pushed commitsha123") // context dirt ALONE triggers the snapshot
  const hash = calls.find((c) => c.args[0] === "hash-object")
  assert.deepEqual(hash.args, ["hash-object", "-w", "--stdin"])
  assert.equal(hash.opts.input, "Agent notes: deploy steps.\n") // marker blocks stripped, real content kept
  const ui = calls.find((c) => c.args[0] === "update-index" && c.args[2] === "--cacheinfo") // the stripped-blob overlay (repair calls precede it)
  assert.deepEqual(ui.args, ["update-index", "--add", "--cacheinfo", "100644,blobsha,CLAUDE.md"])
  assert.equal(ui.opts.env.GIT_INDEX_FILE, calls.find((c) => c.args[0] === "read-tree").opts.env.GIT_INDEX_FILE) // scratch index, never the real one
})

test("a TRACKED context file edited by the agent (markers appended) → the edit is captured WITHOUT markers", async () => {
  const dir = repoDir()
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), `Project docs.\nAgent added this line.\n\n${MARKED}`)
  const { exec, calls } = fakeExec({ ...DIRTY, ...CLEAN_STATUS, ...STAGE, "ls-files": { ok: true, out: "CLAUDE.md" }, show: { ok: true, out: "Project docs." }, "ls-tree": (args) => ({ ok: true, out: args[3] === "CLAUDE.md" ? "100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tCLAUDE.md" : "" }) })
  assert.equal((await checkpointOnce({ env: envFor(dir), exec }))[0].outcome, "pushed commitsha123")
  const repair = calls.find((c) => c.args[0] === "update-index" && c.args[3] === "100644,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,CLAUDE.md")
  assert.ok(repair, "tracked context entry first repaired back to its HEAD blob after the blanket add")
  const hash = calls.find((c) => c.args[0] === "hash-object")
  assert.equal(hash.opts.input, "Project docs.\nAgent added this line.\n") // the agent's edit, not the stale HEAD version
  assert.ok(!hash.opts.input.includes("oyren:"), "no marker block in the snapshot")
  assert.ok(calls.indexOf(repair) < calls.indexOf(calls.find((c) => c.args[3] === "100644,blobsha,CLAUDE.md")), "stripped overlay wins over the repair")
})

test("a TRACKED context file whose only change is the seeded blocks stays clean at the HEAD version", async () => {
  const dir = repoDir()
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), `Project docs.\n\n${MARKED}`)
  const { exec, calls } = fakeExec({ remote: { ok: true, out: "u" }, "rev-parse": (args) => ({ ok: true, out: args[1] === "HEAD" ? "headsha" : "tree1" }), ...CLEAN_STATUS, "ls-files": { ok: true, out: "CLAUDE.md" }, show: { ok: true, out: "Project docs." }, push: { ok: true, out: "" } })
  assert.equal((await checkpointOnce({ env: envFor(dir), exec }))[0].outcome, "pushed headsha")
  assert.ok(!calls.some((c) => c.args[0] === "hash-object" || c.args[0] === "commit-tree"))
})

test("a plain agent-created AGENTS.md (no markers) is fully protected — staged verbatim, never excluded", async () => {
  const dir = repoDir()
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# Deliverable\nThe agent wrote this for the user.\n")
  const { exec, calls } = fakeExec({ ...DIRTY, ...CLEAN_STATUS, ...STAGE })
  assert.equal((await checkpointOnce({ env: envFor(dir), exec }))[0].outcome, "pushed commitsha123")
  assert.equal(calls.find((c) => c.args[0] === "hash-object").opts.input, "# Deliverable\nThe agent wrote this for the user.\n")
  assert.equal(calls.find((c) => c.args[0] === "update-index" && c.args[2] === "--cacheinfo").args[3], "100644,blobsha,AGENTS.md")
  assert.ok(!fs.existsSync(path.join(dir, ".git", "info", "exclude")), "the agent's own `git add -A` is never sabotaged")
})

test("multi-repo layout: EVERY repo child is checkpointed to the same ref on its own origin", async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-ckpt-multi-"))
  fs.mkdirSync(path.join(workdir, "app", ".git"), { recursive: true })
  fs.mkdirSync(path.join(workdir, "lib", ".git"), { recursive: true })
  const { exec, calls } = fakeExec(DIRTY)
  const results = await checkpointOnce({ env: envFor(workdir), exec })
  assert.deepEqual(results.map((r) => path.basename(r.dir)), ["app", "lib"])
  assert.ok(results.every((r) => r.outcome === "pushed commitsha123"))
  const pushes = calls.filter((c) => c.args[0] === "push")
  assert.deepEqual(pushes.map((c) => path.basename(c.opts.cwd)), ["app", "lib"]) // each repo's own cwd/origin
  assert.ok(pushes.every((c) => c.args[3].endsWith(":refs/tags/oyren/checkpoint-my-slug")))
})

test("skips cleanly with no repo / no remote, and a failed push is swallowed + retried next pass", async () => {
  const none = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-ckpt-norepo-"))
  const { exec, calls } = fakeExec({})
  assert.deepEqual(await checkpointOnce({ env: envFor(none), exec }), [])
  assert.equal(calls.length, 0) // never even ran git
  const noRemote = fakeExec({ remote: { ok: false, out: "" } })
  assert.equal((await checkpointOnce({ env: envFor(repoDir()), exec: noRemote.exec }))[0].outcome, "no-remote")
  const badPush = fakeExec({ ...DIRTY, push: { ok: false, out: "" } })
  const env = envFor(repoDir())
  assert.equal((await checkpointOnce({ env, exec: badPush.exec }))[0].outcome, "push-failed") // logged, never thrown
  const goodPush = fakeExec(DIRTY)
  assert.equal((await checkpointOnce({ env, exec: goodPush.exec }))[0].outcome, "pushed commitsha123") // memory untouched by the failure
})

test("tickOnce reports agent meta after the pass, and a meta failure never affects checkpointing", async () => {
  const { exec } = fakeExec(DIRTY)
  const seen = []
  const results = await tickOnce({ env: envFor(repoDir()), exec, report: async (o) => { seen.push(o.env.OYREN_SESSION_SLUG); throw new Error("meta down") } })
  assert.equal(results[0].outcome, "pushed commitsha123")
  assert.deepEqual(seen, ["my-slug"]) // reported once, failure swallowed
})

test("overlapping ticks never interleave — a tickOnce while one is in flight is skipped", async () => {
  const env = envFor(repoDir())
  let release
  const gate = new Promise((r) => { release = r })
  let execCalls = 0
  const exec = async () => { execCalls++; await gate; return { ok: false, out: "" } }
  const first = tickOnce({ env, exec, report: async () => {} })
  assert.deepEqual(await tickOnce({ env, exec, report: async () => {} }), []) // skipped — no interleaved git
  assert.equal(execCalls, 1)
  release()
  assert.equal((await first)[0].outcome, "no-remote")
})

test("each snapshot pass uses its OWN scratch index file (overlap-safe)", async () => {
  const { exec, calls } = fakeExec(DIRTY)
  const env = envFor(repoDir())
  await checkpointOnce({ env, exec })
  await checkpointOnce({ env, exec }) // still dirty → a second snapshot is built (then deduped as unchanged)
  const idx = calls.filter((c) => c.args[0] === "read-tree").map((c) => c.opts.env.GIT_INDEX_FILE)
  assert.equal(idx.length, 2)
  assert.notEqual(idx[0], idx[1])
})

test("start honors the disable flag + agent-runtimes-only gate; timer is unref'd and stoppable", () => {
  assert.equal(start({ env: { AGENT_KIND: "claude-code", OYREN_CHECKPOINT_DISABLED: "1" } }), null)
  assert.equal(start({ env: {} }), null) // not an agent runtime
  const timer = start({ env: { AGENT_KIND: "claude-code" }, intervalMs: 60 * 60 * 1000 })
  assert.ok(timer, "started for an agent runtime")
  assert.equal(start({ env: { AGENT_KIND: "claude-code" } }), null) // idempotent while running
  stop()
})

test("start prefetches the stored agent meta so the first send awaits an already-resolved promise", async () => {
  const agentMeta = require("./agentMeta")
  agentMeta.__reset()
  const metaB64 = Buffer.from(JSON.stringify({ turnCount: 9 })).toString("base64")
  assert.ok(start({ env: { AGENT_KIND: "claude-code", AGENT_META_B64: metaB64 }, intervalMs: 60 * 60 * 1000 }))
  assert.deepEqual(await agentMeta.loadStoredMeta(), { turnCount: 9 }) // cache primed at boot from start's env
  stop(); agentMeta.__reset()
})
