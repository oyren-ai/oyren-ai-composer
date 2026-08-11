// Auto-checkpoint: every ~4 minutes, snapshot each repo's dirty/unpushed work onto the session's
// shadow ref (refs/tags/oyren/checkpoint-<slug>) with a force-push — the safety net that survives a
// container replacement (OOM / DO recycle) wiping the ephemeral filesystem. EVERY cloned repo is
// covered (multi-repo launches push the same ref name to each repo's own origin); the actual pass
// lives in checkpointRepo.js. Push auth rides the existing `oyren` git credential helper (fresh
// /sandbox/git-token per push) — no token handling here. After each pass the tick also reports the
// agent-meta blob (agentMetaReport.js) — best-effort, a meta failure never affects checkpointing.
// Every git failure is swallowed + logged; a checkpoint must never crash or block the server.
// Disable with OYREN_CHECKPOINT_DISABLED=1.
const path = require("path")
const { execFile } = require("child_process")
const { findGitRepoDirs, workdirFrom } = require("./workspaceRepo")
const { checkpointRef } = require("./checkpointRef")
const { checkpointRepoOnce } = require("./checkpointRepo")

const INTERVAL_MS = 4 * 60 * 1000

// Run one git command, never throwing: resolve { ok, out } whatever happens (test seam: `exec`).
// `opts.input` feeds stdin (hash-object --stdin); the 60s timeout kills a hung git (a stalled push)
// so one wedged invocation can never pile ticks up behind it.
const defaultExec = (args, { input, ...opts } = {}) => new Promise((resolve) => {
  try {
    const child = execFile("git", args, { maxBuffer: 8 * 1024 * 1024, timeout: 60_000, ...opts }, (err, stdout) => resolve({ ok: !err, out: String(stdout || "").trim() }))
    if (input !== undefined && child.stdin) child.stdin.end(input)
  } catch (e) { resolve({ ok: false, out: String((e && e.message) || e) }) }
})

const memories = new Map() // repo dir → per-boot { lastHead, lastTree, excludeSeeded }

/** One checkpoint pass over EVERY repo; returns [{ dir, outcome }] ([] when repo-less). */
async function checkpointOnce({ env = process.env, exec = defaultExec } = {}) {
  const results = []
  for (const dir of findGitRepoDirs(workdirFrom(env))) {
    if (!memories.has(dir)) memories.set(dir, {})
    results.push({ dir, outcome: await checkpointRepoOnce(dir, { env, exec, memory: memories.get(dir) }) })
  }
  return results
}

let inFlight = false // reentrancy guard: a slow pass must never interleave scratch/pushes with the next tick

/** One timer tick: checkpoint all repos (loudly logging anything notable), then report meta. */
async function tickOnce({ env = process.env, exec = defaultExec, report } = {}) {
  if (inFlight) return [] // the previous tick is still running — skip this one entirely
  inFlight = true
  try {
    let results = []
    try {
      results = await checkpointOnce({ env, exec })
      for (const { dir, outcome } of results) {
        if (outcome !== "clean" && outcome !== "unchanged") console.error(`[checkpoint] ${path.basename(dir)}: ${outcome}`)
      }
    } catch (e) { console.error(`[checkpoint] failed: ${String((e && e.message) || e)}`) }
    try { await (report || require("./agentMetaReport").reportMeta)({ env }) } catch { /* meta is best-effort, never blocks checkpoints */ }
    return results
  } finally { inFlight = false }
}

let timer = null

/** Start the interval (unref'd — never keeps the process alive). Agent runtimes only; idempotent. */
function start({ env = process.env, intervalMs = INTERVAL_MS } = {}) {
  if (timer || env.OYREN_CHECKPOINT_DISABLED === "1" || !env.AGENT_KIND) return null
  // Kick the cached agent-meta fetch NOW (single-flight, bounded timeout) so the first send()'s
  // blank-boot recovery check awaits an already-resolved promise instead of stalling the turn.
  try { require("./agentMeta").loadStoredMeta({ env }) } catch { /* prefetch is best-effort */ }
  timer = setInterval(() => { tickOnce({ env }) }, intervalMs)
  if (timer.unref) timer.unref()
  return timer
}

/** Stop the interval + clear per-boot memory (tests; a running container never stops it). */
function stop() { if (timer) clearInterval(timer); timer = null; inFlight = false; memories.clear() }

module.exports = { checkpointRef, checkpointOnce, tickOnce, start, stop, INTERVAL_MS }
