// A small in-memory, byte-capped tail of recent server + app output — the container has no
// persistent disk, so this is the only place output survives between the moment it's printed and
// the moment /_oyren/logs is loaded. Two feeds write into the same buffer:
//   - installConsoleCapture(): tees this process's own console.log/error/warn/info (boot messages,
//     the "[fatal] ..." crash breadcrumbs in server.js, etc).
//   - pipeChildOutput(child): tees a spawned child's stdout/stderr (the supervisor's managed app).
// Both still write through to the real stdout/stderr first, so nothing is hidden from `docker logs` /
// DO's platform logs — this buffer is purely an additional, in-container view. Never throws: a bug in
// the logging path must not take the server down or block the thing it's trying to log.
const util = require("util")

const LOG_BUFFER_MAX_BYTES = Number(process.env.LOG_BUFFER_MAX_BYTES) || 2 * 1024 * 1024

let entries = [] // { t, stream, text } — one line each, oldest first, no trailing newline
let byteSize = 0
const partial = {} // stream -> leftover text without a trailing newline yet (child output arrives in arbitrary chunks)

/** Record one complete line. `stream` is a free-form label ("stdout" | "stderr" | "server"). */
function record(stream, text) {
  try {
    entries.push({ t: Date.now(), stream, text })
    byteSize += Buffer.byteLength(text) + 32 // rough per-entry overhead so the cap holds under real usage
    while (byteSize > LOG_BUFFER_MAX_BYTES && entries.length > 1) {
      byteSize -= Buffer.byteLength(entries.shift().text) + 32
    }
  } catch {
    // logging must never throw into the caller
  }
}

/** Split a raw chunk (which may contain 0, 1, or many newlines, and may not end on one) into
 *  complete lines, carrying any trailing partial line over to the next chunk on the same stream. */
function recordChunk(stream, chunk) {
  try {
    const text = (partial[stream] || "") + String(chunk)
    const lines = text.split("\n")
    partial[stream] = lines.pop() // last element is either "" (chunk ended on \n) or a partial line
    for (const line of lines) record(stream, line)
  } catch {
    // ignore — see record()
  }
}

/** Tee this process's own console output into the buffer. Call once, at boot. Idempotent. */
let consoleCaptured = false
function installConsoleCapture() {
  if (consoleCaptured) return
  consoleCaptured = true
  for (const [method, stream] of [["log", "stdout"], ["info", "stdout"], ["warn", "stderr"], ["error", "stderr"]]) {
    const orig = console[method].bind(console)
    console[method] = (...args) => {
      orig(...args)
      record(stream, util.format(...args))
    }
  }
}

/** Tee a spawned child's stdout/stderr into the buffer, still forwarding to this process's own
 *  streams (so platform-level log capture keeps working unchanged). No-op for a child with no
 *  piped stdio (e.g. a test double, or `stdio: "inherit"`). */
function pipeChildOutput(child) {
  if (child && child.stdout) {
    child.stdout.on("data", (buf) => { try { process.stdout.write(buf) } catch {}; recordChunk("stdout", buf) })
  }
  if (child && child.stderr) {
    child.stderr.on("data", (buf) => { try { process.stderr.write(buf) } catch {}; recordChunk("stderr", buf) })
  }
}

/** Point-in-time copy of the buffered tail, oldest first. */
function snapshot() {
  return entries.slice()
}

/** Test/reset hook — drop the buffer and any partial lines. */
function reset() {
  entries = []
  byteSize = 0
  for (const k of Object.keys(partial)) delete partial[k]
}

module.exports = { record, recordChunk, installConsoleCapture, pipeChildOutput, snapshot, reset, LOG_BUFFER_MAX_BYTES }
