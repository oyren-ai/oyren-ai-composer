// Stream a script's output via Server-Sent Events (SSE) — live visibility into long-running commands.
// Also writes output to a log file in .oyren-deliver/ so the workspace can display it.
// This complements the existing run/run_result flow (which buffers and polls).
const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Stream a command's output via SSE. Each stdout/stderr chunk is sent as a `data:` line.
 * The final event is `event: done` with the exit code and timeout status.
 * Also writes all output to a log file for workspace visibility.
 *
 * @param {object} res - HTTP response (must support streaming)
 * @param {string} command - Shell command to run
 * @param {object} opts - { cwd, env, timeoutMs, workdir }
 */
function runStreaming(res, command, { cwd, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, workdir, spawnFn = spawn } = {}) {
  // Set up SSE headers
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
  })

  // Create log file in deliverables folder
  const deliverDir = path.join(workdir || cwd || "/workspace", ".oyren-deliver")
  try { fs.mkdirSync(deliverDir, { recursive: true }) } catch {}
  const runId = `run-${crypto.randomBytes(4).toString("hex")}`
  const logPath = path.join(deliverDir, `${runId}.log`)
  const logStream = fs.createWriteStream(logPath, { flags: "a" })

  // Write header to log
  const header = `# Script Run: ${runId}\n# Command: ${command}\n# Started: ${new Date().toISOString()}\n# CWD: ${cwd || workdir || "/workspace"}\n${"=".repeat(60)}\n\n`
  logStream.write(header)

  // Send initial event with log path
  res.write(`event: start\ndata: ${JSON.stringify({ runId, logPath: logPath.replace(workdir || "", "") })}\n\n`)

  let timedOut = false
  let settled = false
  let timer

  const finish = (exitCode) => {
    if (settled) return
    settled = true
    clearTimeout(timer)

    // Write footer to log
    const footer = `\n${"=".repeat(60)}\n# Finished: ${new Date().toISOString()}\n# Exit code: ${exitCode}\n# Timed out: ${timedOut}\n`
    logStream.write(footer)
    // "done" promises a complete log: anyone reacting to it (run_result, the runs panel, a curl
    // loop tailing the file) reads the log file immediately, so the footer must be on disk first.
    logStream.end(() => {
      res.write(`event: done\ndata: ${JSON.stringify({ exitCode, timedOut, runId })}\n\n`)
      res.end()
    })
  }

  let child
  try {
    child = spawnFn("bash", ["-lc", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
  } catch (err) {
    const errMsg = String((err && err.message) || err)
    res.write(`event: stderr\ndata: ${JSON.stringify(errMsg)}\n\n`)
    logStream.write(`[ERROR] ${errMsg}\n`)
    return finish(null)
  }

  timer = setTimeout(() => {
    timedOut = true
    const msg = `\n[TIMEOUT] Command killed after ${timeoutMs}ms\n`
    res.write(`event: stderr\ndata: ${JSON.stringify(msg)}\n\n`)
    logStream.write(msg)
    child.kill("SIGKILL")
  }, timeoutMs)

  // Stream stdout
  child.stdout.on("data", (chunk) => {
    const text = String(chunk)
    res.write(`event: stdout\ndata: ${JSON.stringify(text)}\n\n`)
    logStream.write(text)
  })

  // Stream stderr
  child.stderr.on("data", (chunk) => {
    const text = String(chunk)
    res.write(`event: stderr\ndata: ${JSON.stringify(text)}\n\n`)
    logStream.write(`[stderr] ${text}`)
  })

  child.on("error", (err) => {
    const errMsg = String((err && err.message) || err)
    res.write(`event: stderr\ndata: ${JSON.stringify(errMsg)}\n\n`)
    logStream.write(`[ERROR] ${errMsg}\n`)
    finish(null)
  })

  child.on("close", (code) => finish(code))

  // Handle client disconnect
  res.on("close", () => {
    if (!settled) {
      logStream.write("\n[DISCONNECTED] Client disconnected, killing process\n")
      child.kill("SIGKILL")
      settled = true
      clearTimeout(timer)
      logStream.end()
    }
  })
}

/**
 * List available log files from previous script runs.
 */
function listRunLogs(workdir) {
  const deliverDir = path.join(workdir, ".oyren-deliver")
  try {
    const files = fs.readdirSync(deliverDir)
      .filter(f => f.startsWith("run-") && f.endsWith(".log"))
      .map(f => {
        const stat = fs.statSync(path.join(deliverDir, f))
        return { name: f, size: stat.size, mtime: stat.mtime.toISOString() }
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime)) // newest first
    return files
  } catch {
    return []
  }
}

/**
 * Read a specific log file's contents. `runId` is caller-supplied (it arrives in a request body),
 * so it is pinned to the shape runStreaming actually mints — a traversing id like
 * "../../../../etc/passwd" would otherwise read /etc/passwd.log straight off the host.
 */
function readRunLog(workdir, runId) {
  if (!/^run-[0-9a-f]+$/.test(String(runId))) return null
  const logPath = path.join(workdir, ".oyren-deliver", `${runId}.log`)
  try {
    return fs.readFileSync(logPath, "utf-8")
  } catch {
    return null
  }
}

module.exports = { runStreaming, listRunLogs, readRunLog, DEFAULT_TIMEOUT_MS }
