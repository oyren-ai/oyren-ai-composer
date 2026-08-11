// One checkpoint pass over ONE repo: decide whether anything needs saving, build a detached snapshot
// commit (scratch index seeded from HEAD — the agent's real index and HEAD are never touched), and
// force-push it to the session's shadow ref. Two in-memory (per-boot) trackers make it correct and
// quiet: `memory.lastHead` detects unpushed commits WITHOUT depending on an upstream existing
// (rev-list @{upstream} fails on checkout-created branches), and `memory.lastTree` skips the push
// entirely when the snapshot content is identical to what was last pushed (the first tick after a
// boot may push once — that is fine). Context files (CLAUDE.md & co.) are staged with the oyren
// marker blocks stripped — real user/agent content IS checkpointed, only the seeded blocks never
// leak (checkpointContext.js). Returns a short outcome tag for the log.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { checkpointRef } = require("./checkpointRef")
const { excludePathspecs, contextFileDirt, stageContextDirt, repairContextEntries } = require("./checkpointContext")

const IDENTITY = { GIT_AUTHOR_NAME: "Oyren Agent", GIT_AUTHOR_EMAIL: "contact@oyren.ai", GIT_COMMITTER_NAME: "Oyren Agent", GIT_COMMITTER_EMAIL: "contact@oyren.ai" }

let scratchSeq = 0 // per-snapshot unique scratch index name: overlapping passes never share an index

/** Snapshot the dirty worktree into a detached commit via a throwaway index; { commit, tree } or null. */
async function snapshotCommit(git, headSha, dirt) {
  const indexFile = path.join(os.tmpdir(), `oyren-checkpoint-index-${process.pid}-${++scratchSeq}`)
  const scratch = { GIT_INDEX_FILE: indexFile }
  try {
    // Seed from HEAD, blanket-stage the worktree (no :(exclude) pathspecs — naming a gitignored
    // context file there makes `git add` exit 1 and would fail the whole snapshot), then repair the
    // context entries back to the HEAD baseline and overlay the stripped blobs for the really-dirty.
    if (!(await git(["read-tree", headSha], scratch)).ok) return null
    if (!(await git(["add", "-A", "--", "."], scratch)).ok) return null
    if (!(await repairContextEntries(git, scratch, headSha))) return null
    if (!(await stageContextDirt(git, scratch, dirt))) return null
    const tree = await git(["write-tree"], scratch)
    if (!tree.ok) return null
    const made = await git(["commit-tree", tree.out, "-p", headSha, "-m", `oyren.ai checkpoint ${new Date().toISOString()}`], IDENTITY)
    return made.ok ? { commit: made.out, tree: tree.out } : null
  } finally { try { fs.unlinkSync(indexFile) } catch { /* scratch cleanup is best-effort */ } }
}

/** One pass for `repo`; `memory` is this repo's per-boot { lastHead, lastTree }. */
async function checkpointRepoOnce(repo, { env = process.env, exec, memory = {} } = {}) {
  const git = (args, extraEnv, input) => exec(args, { cwd: repo, env: extraEnv ? { ...env, ...extraEnv } : env, ...(input === undefined ? {} : { input }) })
  const remote = await git(["remote", "get-url", "origin"])
  if (!remote.ok || !remote.out) return "no-remote"
  const head = await git(["rev-parse", "HEAD"])
  if (!head.ok) return "no-head" // empty repo — nothing to snapshot yet
  const status = await git(["status", "--porcelain", "--", ".", ...excludePathspecs()])
  if (!status.ok) return "status-failed"
  const dirt = await contextFileDirt(repo, git) // context files count as dirt only STRIPPED-vs-HEAD
  if (!status.out && !dirt.length && head.out === memory.lastHead) return "clean"
  let commit = head.out, tree = null
  if (status.out || dirt.length) {
    const snap = await snapshotCommit(git, head.out, dirt)
    if (!snap) return "snapshot-failed"
    commit = snap.commit; tree = snap.tree
  } else {
    const t = await git(["rev-parse", `${head.out}^{tree}`])
    tree = t.ok ? t.out : null
  }
  if (tree && tree === memory.lastTree) { memory.lastHead = head.out; return "unchanged" } // same content already on the shadow ref
  const push = await git(["push", "-f", "origin", `${commit}:refs/tags/${checkpointRef(env)}`])
  if (!push.ok) return "push-failed" // memory untouched → retried next tick
  memory.lastHead = head.out
  if (tree) memory.lastTree = tree
  return `pushed ${commit.slice(0, 12)}`
}

module.exports = { checkpointRepoOnce }
