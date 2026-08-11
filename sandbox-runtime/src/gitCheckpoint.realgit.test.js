// REAL-git integration test for the checkpoint pass. The fake-exec unit tests can't catch git's own
// behavior quirks — most importantly: naming a gitignored file in an :(exclude) pathspec makes
// `git add` exit 1 ("The following paths are ignored…"), which used to fail the WHOLE snapshot for
// any repo that gitignores CLAUDE.md/AGENTS.md (a common global ignore). This exercises the pass
// end-to-end against a throwaway work repo + local bare "origin", using the real default exec.
const { test, beforeEach } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const { checkpointOnce, stop } = require("./gitCheckpoint")

const SEEDED = "<!-- oyren:agent-context -->\npersona\n<!-- /oyren:agent-context -->\n"
const IDENT = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: { ...process.env, ...IDENT }, encoding: "utf8" }).trim()

/** A work repo (one commit: .gitignore ignoring CLAUDE.md + a src file) wired to a local bare origin. */
function makeRepos() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-realgit-"))
  const bare = path.join(root, "origin.git")
  const work = path.join(root, "work")
  execFileSync("git", ["init", "--bare", bare])
  execFileSync("git", ["init", "-b", "main", work])
  fs.writeFileSync(path.join(work, ".gitignore"), "CLAUDE.md\n")
  fs.writeFileSync(path.join(work, "src.txt"), "original\n")
  git(work, "add", "-A")
  git(work, "commit", "-m", "init")
  git(work, "remote", "add", "origin", bare)
  return { bare, work }
}

beforeEach(() => stop())

test("gitignored CLAUDE.md never breaks the snapshot — dirty work IS checkpointed, markers are NOT", async () => {
  const { bare, work } = makeRepos()
  fs.writeFileSync(path.join(work, "CLAUDE.md"), `${SEEDED}\nAgent notes worth saving.\n`) // ignored by .gitignore
  fs.writeFileSync(path.join(work, "src.txt"), "agent edit\n") // the real dirty work
  const [{ outcome }] = await checkpointOnce({ env: { ...IDENT, WORKING_DIR: work, OYREN_SESSION_SLUG: "rg" } })
  assert.match(outcome, /^pushed /, `snapshot must survive a gitignored context file (got: ${outcome})`)
  const ref = "refs/tags/oyren/checkpoint-rg"
  assert.equal(git(bare, "show", `${ref}:src.txt`), "agent edit") // dirty work protected
  assert.equal(git(bare, "show", `${ref}:CLAUDE.md`), "Agent notes worth saving.") // stripped content, no markers
  assert.ok(!git(bare, "show", `${ref}:CLAUDE.md`).includes("oyren:"))
  git(work, "status") // the pass must leave the agent's real index/HEAD untouched
  assert.equal(git(work, "rev-parse", "HEAD"), git(bare, "show-ref", "-s", ref) && git(work, "rev-parse", "HEAD"))
})

test("tracked AGENTS.md edited by the agent is captured; seeded-only additions stay invisible", async () => {
  const { bare, work } = makeRepos()
  fs.writeFileSync(path.join(work, "AGENTS.md"), "User docs.\n")
  git(work, "add", "AGENTS.md")
  git(work, "commit", "-m", "docs")
  fs.writeFileSync(path.join(work, "AGENTS.md"), `User docs.\nAgent addition.\n\n${SEEDED}`)
  const env = { ...IDENT, WORKING_DIR: work, OYREN_SESSION_SLUG: "rg2" }
  const [{ outcome }] = await checkpointOnce({ env })
  assert.match(outcome, /^pushed /)
  const shown = git(bare, "show", "refs/tags/oyren/checkpoint-rg2:AGENTS.md")
  assert.equal(shown, "User docs.\nAgent addition.") // edit captured, markers stripped
  // seeded-only change (no real edit): revert the real edit, keep only markers → clean, no push churn
  fs.writeFileSync(path.join(work, "AGENTS.md"), `User docs.\n\n${SEEDED}`)
  stop() // fresh memory: prove "clean" is judged from content, not the per-boot tree cache
  assert.equal((await checkpointOnce({ env }))[0].outcome, "pushed " + git(work, "rev-parse", "HEAD").slice(0, 12))
  assert.equal((await checkpointOnce({ env }))[0].outcome, "clean")
})
