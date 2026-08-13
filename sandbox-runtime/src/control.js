// The `/_oyren/control/*` API: expose a port, start/restart/stop the user app, read status,
// and manage proxy routes. Auth is a single CONTROL_TOKEN known only to the orchestrator
// (server-to-server over the DO URL) and the in-container `oyren` CLI — NOT the SESSION_TOKEN
// the browser holds for the terminal.
const crypto = require("crypto")
const path = require("path")
const { setManifestPort } = require("./manifest")
const { routeFor } = require("./routeFor")
const { readContainerStats } = require("./stats")
const { runCaptured } = require("./runScript")
const { runAction, runResultAction } = require("./controlRun")
const { runStreaming, listRunLogs, readRunLog } = require("./runStream")
const { routeAction } = require("./controlRoutes")
const { jobs: defaultJobs } = require("./sharedJobs") // one process-wide registry, shared with runs.js

function tokenOk(req, expected) {
  if (!expected) return false
  const got = req.headers["x-oyren-control-token"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
  const a = Buffer.from(String(got)), b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")) } catch { resolve({}) } })
    req.on("error", () => resolve({}))
  })
}

function send(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(obj))
}

/** Dispatch a `/_oyren/control/<action>` request against the supervisor. */
async function handleControl(req, res, { supervisor, workdir, token, routes, runner = runCaptured, jobs = defaultJobs }) {
  if (!tokenOk(req, token)) return send(res, 401, { error: "unauthorized" })
  const action = routeFor(req.url).kind === "control" ? req.url.split("?")[0].replace(/^\/_oyren\/control\/?/, "") : ""
  const body = req.method === "GET" ? {} : await readJson(req)

  if (action === "expose") {
    const port = Number(body.port)
    if (!port) return send(res, 400, { error: "port is required" })
    setManifestPort(workdir, port)
    return send(res, 200, supervisor.expose(port))
  }
  if (action === "start") return send(res, 200, await supervisor.start(body.port ? Number(body.port) : undefined))
  if (action === "restart") {
    const s = await supervisor.restart()
    return send(res, s.managed ? 200 : 409, s)
  }
  if (action === "stop") return send(res, 200, await supervisor.stop())
  if (action === "status") return send(res, 200, await supervisor.status())
  if (action === "stats") return send(res, 200, await readContainerStats({ workdir }))

  // Run a script and return its captured output — or `{ runId }` when detached (see controlRun.js).
  if (action === "run") {
    const r = await runAction(body, { workdir, runner, jobs })
    return send(res, r.status, r.payload)
  }
  if (action === "run_result") {
    const r = runResultAction(body, { jobs })
    return send(res, r.status, r.payload)
  }

  // Stream a script's output via SSE — live visibility into long-running commands.
  // Output is also written to a log file in .oyren-deliver/ for workspace visibility.
  if (action === "run_stream") {
    const command = String(body.command || body.script || "")
    if (!command) return send(res, 400, { error: "command is required" })
    const cwd = body.cwd ? path.resolve(workdir, String(body.cwd)) : workdir
    const timeoutMs = Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : undefined
    return runStreaming(res, command, { cwd, timeoutMs, workdir })
  }

  // List available log files from previous script runs.
  if (action === "run_logs") {
    return send(res, 200, { logs: listRunLogs(workdir) })
  }

  // Read a specific log file's contents.
  if (action === "run_log") {
    const runId = String(body.runId || "")
    if (!runId) return send(res, 400, { error: "runId is required" })
    const content = readRunLog(workdir, runId)
    if (content === null) return send(res, 404, { error: "log not found" })
    return send(res, 200, { runId, content })
  }

  // Route management lives in controlRoutes.js; route/list additionally answers `origin` — the
  // port proxy's capability probe — when the public origin is knowable (see publicOrigin.js).
  const routed = routeAction(action, body, { routes })
  if (routed) return send(res, routed.status, routed.payload)

  return send(res, 404, { error: "unknown control action" })
}

module.exports = { handleControl, tokenOk }
