// GET /_oyren/runs?token=<SESSION_TOKEN> — JSON list of recent DETACHED script runs (newest-first)
// with their command, status, exit code, timing, and output tails. This is the browser-facing view
// of the same in-memory registry the orchestrator polls by runId over the CONTROL_TOKEN `run_result`
// endpoint — it lets the Script Runner panel show what the agent ran and its output instead of an
// interactive PTY shell. Auth reuses the SESSION_TOKEN `?token=` gate (same secret as /_oyren/logs +
// /agent/message + /terminal).
//
// GET /_oyren/runs?token=…&runId=<id> — one run's FULL (untruncated) output, or 404 once pruned.
const { tokenOk, json, handleCorsOptions } = require("./agentHttp")
const { jobs } = require("./sharedJobs")

const CORS = { allowCors: true }

/** Entry from the HTTP router (route.kind === "runs"). */
function handleRuns(req, res, { runJobs = jobs } = {}) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") return handleCorsOptions(res)
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" }, CORS)
  const runId = new URL(req.url, "http://localhost").searchParams.get("runId")
  if (runId) {
    const run = runJobs.get(runId)
    if (!run) return json(res, 404, { error: "run not found" }, CORS)
    return json(res, 200, { run }, CORS)
  }
  return json(res, 200, { runs: runJobs.list() }, CORS)
}

module.exports = { handleRuns }
