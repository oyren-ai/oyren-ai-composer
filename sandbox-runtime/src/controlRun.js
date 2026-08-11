// The `run` / `run_result` control actions, extracted from control.js: run a script to completion
// and return its captured output (sync mode, unchanged), or with `detach: true` return `{ runId }`
// immediately and let the orchestrator poll `run_result` — how the MCP run_script tool survives
// commands that outlive a single HTTP request. Each returns { status, payload } for control.js.
const path = require("path")

/** POST run `{ command, cwd?, timeoutMs?, detach? }` → captured output, or `{ runId }` when detached. */
async function runAction(body, { workdir, runner, jobs }) {
  const command = String(body.command || body.script || "")
  if (!command) return { status: 400, payload: { error: "command is required" } }
  const cwd = body.cwd ? path.resolve(workdir, String(body.cwd)) : workdir
  const timeoutMs = Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : undefined
  if (body.detach === true) {
    // Pass onOutput callback through to runCaptured for partial output streaming
    const started = jobs.start((onOutput) => runner(command, { cwd, timeoutMs, onOutput }), { command })
    return { status: started.error ? 429 : 200, payload: started }
  }
  return { status: 200, payload: await runner(command, { cwd, timeoutMs }) }
}

/** POST run_result `{ runId }` → { status: "running" | "done" (with output) | "unknown" }. */
function runResultAction(body, { jobs }) {
  if (!body.runId) return { status: 400, payload: { error: "runId is required" } }
  return { status: 200, payload: jobs.result(body.runId) }
}

module.exports = { runAction, runResultAction }
