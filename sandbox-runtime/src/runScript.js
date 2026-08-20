// Run a shell command to completion and CAPTURE its output — the primitive behind the
// `/_oyren/control/run` endpoint (the "script-app": run `pnpm test:coverage`, `pnpm build`, a bash or
// node script, … and hand stdout/stderr/exitCode back to the caller). This is deliberately different
// from the supervisor (which streams a long-running server's output to the container log with
// stdio:"inherit") and from the terminal PTY (interactive, no completion signal) — here we buffer and
// resolve when the process exits.
const { spawn } = require("child_process")
const { appEnv } = require("./appEnv")

const MAX_OUTPUT = 1024 * 1024 // cap each stream at 1 MiB so a runaway script can't exhaust memory
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes — matches the orchestrator's per-request ceiling

/**
 * Spawn `bash -lc <command>` in `cwd`, buffer stdout/stderr (capped), and resolve
 * `{ stdout, stderr, exitCode, timedOut }` when it finishes. Never rejects — a spawn error resolves
 * with exitCode null and the error text on stderr, so the HTTP layer always gets a clean JSON body.
 *
 * @param {string} command - Shell command to run
 * @param {object} opts
 * @param {string} opts.cwd - Working directory
 * @param {object} opts.env - Environment variables
 * @param {number} opts.timeoutMs - Timeout in milliseconds
 * @param {function} opts.spawnFn - Spawn function (for testing)
 * @param {object} opts.logger - Logger object
 * @param {function} opts.onOutput - Callback for incremental output: (stdout, stderr) => void
 */
function runCaptured(command, { cwd, env = appEnv(), timeoutMs = DEFAULT_TIMEOUT_MS, spawnFn = spawn, logger = console, onOutput } = {}) {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false
    let timer
    const cap = (cur, chunk) => (cur.length >= MAX_OUTPUT ? cur : (cur + chunk).slice(0, MAX_OUTPUT))
    const finish = (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      logger.info?.(`[script-runner] finished exitCode=${exitCode ?? "null"} timedOut=${timedOut}`)
      resolve({ stdout, stderr, exitCode, timedOut })
    }

    logger.info?.("[script-runner] command started")
    let child
    try {
      child = spawnFn("bash", ["-lc", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    } catch (err) {
      stderr = String((err && err.message) || err)
      return finish(null)
    }

    timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)

    child.stdout.on("data", (c) => {
      stdout = cap(stdout, String(c))
      if (onOutput) onOutput(stdout, stderr)
    })
    child.stderr.on("data", (c) => {
      stderr = cap(stderr, String(c))
      if (onOutput) onOutput(stdout, stderr)
    })
    child.on("error", (err) => { stderr = cap(stderr, String((err && err.message) || err)); finish(null) })
    child.on("close", (code) => finish(code))
  })
}

module.exports = { runCaptured, MAX_OUTPUT, DEFAULT_TIMEOUT_MS }
