// In-memory registry of DETACHED script runs behind `/_oyren/control/run {detach:true}` +
// `/_oyren/control/run_result`: the run starts in the background (output buffered by runScript.js as
// usual) and the caller polls for `{status: running|done|unknown}` by runId. Completed jobs are kept
// ~30 minutes for late polls, then pruned (lazily, on every start/result call) — after a prune or a
// process restart an id answers `unknown`, telling the orchestrator to rerun. At most 4 jobs run
// concurrently; excess starts return an error instead of queueing.
//
// The registry also powers the browser-facing `/_oyren/runs` panel (see runs.js): each job records
// the `command` it ran and when it `startedAt`, and `list()` returns them newest-first so a human can
// see what the agent ran and its output — the same data the orchestrator polls by runId, minus the
// CONTROL_TOKEN requirement.
const crypto = require("crypto")

const PRUNE_AFTER_MS = 30 * 60 * 1000
const MAX_CONCURRENT = 4
// Cap the per-stream output echoed into `list()` so the runs-panel payload stays small even when a
// command prints megabytes — the full output is still available via `get(runId)` / run_result.
const LIST_TAIL_BYTES = 16 * 1024

/** Last `maxBytes` chars of a string, prefixed with an elision marker when truncated. */
function tail(text, maxBytes) {
  const s = String(text || "")
  if (s.length <= maxBytes) return s
  return "…[truncated]\n" + s.slice(s.length - maxBytes)
}

function createRunJobs({ now = Date.now, maxConcurrent = MAX_CONCURRENT, pruneAfterMs = PRUNE_AFTER_MS } = {}) {
  // runId → { command, startedAt, finishedAt: null|ms, result: null|{stdout,stderr,exitCode,timedOut} }
  const jobs = new Map()

  const prune = () => { for (const [id, job] of jobs) { if (job.finishedAt != null && now() - job.finishedAt > pruneAfterMs) jobs.delete(id) } }
  const runningCount = () => [...jobs.values()].filter((job) => job.finishedAt == null).length

  /** Kick off `run` (a (onOutput) => Promise<runScript result>) in the background → { runId } | { error }.
   *  `meta.command` is recorded so the runs panel can show what was executed.
   *  The `run` function receives an `onOutput(stdout, stderr)` callback to stream partial output. */
  function start(run, meta = {}) {
    prune()
    if (runningCount() >= maxConcurrent) return { error: `too many concurrent detached runs (max ${maxConcurrent}) — wait for one to finish` }
    const runId = `run-${crypto.randomBytes(8).toString("hex")}`
    // partial holds live output while running; result is set when done
    const job = { command: String(meta.command || ""), startedAt: now(), finishedAt: null, result: null, partial: { stdout: "", stderr: "" } }
    jobs.set(runId, job)
    // Pass onOutput callback so runCaptured can stream partial output
    const onOutput = (stdout, stderr) => {
      job.partial.stdout = stdout
      job.partial.stderr = stderr
    }
    Promise.resolve().then(() => run(onOutput)).then(
      (result) => { job.result = result; job.finishedAt = now() },
      (err) => { job.result = { stdout: "", stderr: String((err && err.message) || err), exitCode: null, timedOut: false }; job.finishedAt = now() },
    )
    return { runId }
  }

  /** Poll a run: running (with partial output), done (with the captured output), or unknown (pruned / never existed). */
  function result(runId) {
    prune()
    const job = jobs.get(String(runId))
    if (!job) return { status: "unknown" }
    if (job.finishedAt == null) {
      // Include partial output so callers can show progress
      return { status: "running", stdout: job.partial.stdout, stderr: job.partial.stderr }
    }
    return { status: "done", ...job.result }
  }

  /** One run's browser-panel view. `full` returns untruncated output (single-run reads). */
  function view(runId, job, full) {
    const running = job.finishedAt == null
    // Use partial output while running, final result when done
    const r = running ? job.partial : (job.result || {})
    return {
      runId,
      command: job.command,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      status: running ? "running" : "done",
      exitCode: running ? null : (r.exitCode ?? null),
      timedOut: running ? false : !!r.timedOut,
      stdout: full ? String(r.stdout || "") : tail(r.stdout, LIST_TAIL_BYTES),
      stderr: full ? String(r.stderr || "") : tail(r.stderr, LIST_TAIL_BYTES),
      truncated: !full && ((String(r.stdout || "")).length > LIST_TAIL_BYTES || (String(r.stderr || "")).length > LIST_TAIL_BYTES),
    }
  }

  /** All known runs, newest-first, with output tails — the `/_oyren/runs` list payload. */
  function list() {
    prune()
    return [...jobs.entries()]
      .map(([runId, job]) => view(runId, job, false))
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  /** One run's full (untruncated) view, or null if unknown/pruned — `/_oyren/runs?runId=…`. */
  function get(runId) {
    prune()
    const job = jobs.get(String(runId))
    return job ? view(String(runId), job, true) : null
  }

  return { start, result, list, get }
}

module.exports = { createRunJobs, PRUNE_AFTER_MS, MAX_CONCURRENT, LIST_TAIL_BYTES }
