// Drives the wrapper exactly the way the Claude Code VS Code extension does (verified empirically):
// spawn `wrapper <claude-binary> --output-format stream-json --verbose --input-format stream-json`
// with pipes and no shell, write an NDJSON initialize control_request on stdin, read NDJSON off
// stdout, and on panel close SIGTERM-then-SIGKILL the wrapper (onDidDispose's sequence).
const { spawn } = require("child_process")
const path = require("path")

const WRAPPER_MAIN = path.join(__dirname, "..", "..", "claude-wrapper", "main.js")
const FAKE_CLAUDE = path.join(__dirname, "..", "fixtures", "fake-claude.js")
const CLAUDE_ARGS = ["--output-format", "stream-json", "--verbose", "--input-format", "stream-json"]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function waitFor(cond, timeoutMs = 5000, what = "condition") {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (cond()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error(`timed out waiting for ${what}`))
      setTimeout(tick, 15)
    }
    tick()
  })
}

function spawnFakeExtension({ socketPath, dumpPath, env = {}, cwd, flagOn = true } = {}) {
  const childEnv = {
    PATH: process.env.PATH,
    ...(dumpPath ? { FAKE_CLAUDE_DUMP: dumpPath } : {}),
    ...(socketPath ? { OYREN_CLAUDE_WRAPPER_SOCKET: socketPath } : {}),
    ...(flagOn ? { OYREN_CLAUDE_WRAPPER: "1" } : {}),
    ...env,
  }
  const child = spawn(process.execPath, [WRAPPER_MAIN, process.execPath, FAKE_CLAUDE, ...CLAUDE_ARGS], {
    cwd, env: childEnv, stdio: ["pipe", "pipe", "pipe"], shell: false,
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (d) => { stdout += d.toString("utf8") })
  child.stderr.on("data", (d) => { stderr += d.toString("utf8") })

  const api = {
    child,
    env: childEnv,
    expectedChildArgv: [process.execPath, FAKE_CLAUDE, ...CLAUDE_ARGS],
    stdout: () => stdout,
    stderr: () => stderr,
    stdoutLines: () => stdout.split("\n").filter(Boolean),
    jsonLines: () => api.stdoutLines().map((l) => { try { return JSON.parse(l) } catch { return { unparseable: l } } }),
    /** Wrapper stderr lines that are the WRAPPER's own (not the child's) — the loud-fallback probe. */
    wrapperStderrLines: () => stderr.split("\n").filter((l) => l.includes("oyren-claude-wrapper:")),
    writeInitialize: () => child.stdin.write(JSON.stringify({
      type: "control_request", request_id: `req-${Date.now()}`, request: { subtype: "initialize" },
    }) + "\n"),
    writeUserMessage: (text = "hi") => child.stdin.write(JSON.stringify({
      type: "user", message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n"),
    waitForStdout: (substr, timeoutMs = 5000) =>
      waitFor(() => stdout.includes(substr), timeoutMs, `stdout to include ${substr}`),
    waitExit: (timeoutMs = 5000) =>
      waitFor(() => child.exitCode !== null || child.signalCode !== null, timeoutMs, "wrapper exit"),
    /** The extension's onDidDispose: SIGTERM, then SIGKILL if the wrapper is still alive. */
    panelClose: async () => {
      child.kill("SIGTERM")
      await sleep(150)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await api.waitExit()
    },
    dispose: () => { try { child.kill("SIGKILL") } catch { /* already dead */ } },
  }
  return api
}

module.exports = { spawnFakeExtension, waitFor, sleep, WRAPPER_MAIN, FAKE_CLAUDE, CLAUDE_ARGS }
