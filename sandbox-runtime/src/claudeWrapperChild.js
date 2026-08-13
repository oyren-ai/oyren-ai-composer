// The broker's child handle: a PIPES-ONLY spawn of exactly what the wrapper was asked to run.
// NEVER node-pty: the extension runs claude with --input-format=stream-json, which hard-fails on a
// TTY ("requires --print"), and PTY echo would corrupt the NDJSON streams. detached:true puts the
// child in its own process group so signals aimed at the broker's group never touch it.
//
// Env: the caller passes hello.env VERBATIM — full passthrough, no allowlist. The wrapper occupies
// the exact trust domain the child would occupy without a wrapper (the extension spawns both with
// the same env); filtering here would break auth/BYOK in ways the no-wrapper world doesn't. What
// must NOT leak is the BROKER's own env — so the spawn env is hello.env alone, never merged over
// process.env (the registry tests pin this).
const { spawn } = require("child_process")

const TAIL_BYTES = 4096 // last-resort diagnostics kept while nobody is attached

function createChild({ argv, cwd, env }) {
  const child = spawn(argv[0], argv.slice(1), {
    cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: true, shell: false,
  })
  let sink = null // { stdout(buf), stderr(buf), exit(info) } — the connected wrapper's socket, if any
  const observers = [] // persistent taps (the turn-state scanner) — attached for the child's whole life
  const exitListeners = []
  let tail = Buffer.alloc(0)
  let exited = null

  // Always-consume guarantee: these 'data' handlers attach at spawn and NEVER detach, so the child
  // can never block on a full 64KB pipe while no wrapper is connected — output beyond the small
  // diagnostic tail is simply discarded during a drain.
  const consume = (stream) => (buf) => {
    for (const cb of observers) { try { cb(stream, buf) } catch { /* a bad tap must not stall the pipe */ } }
    if (sink) { try { sink[stream](buf) } catch { /* socket already gone */ } }
    else tail = Buffer.concat([tail, buf]).subarray(-TAIL_BYTES)
  }
  child.stdout.on("data", consume("stdout"))
  child.stderr.on("data", consume("stderr"))
  child.stdin.on("error", () => { /* EPIPE when the child dies mid-write — reported via its exit */ })

  const settle = (info) => {
    if (exited) return
    exited = info
    if (sink) { try { sink.exit(info) } catch { /* socket already gone */ } }
    for (const cb of exitListeners.splice(0)) { try { cb(info) } catch { /* listener's problem */ } }
  }
  // A spawn failure (ENOENT etc) surfaces as a 127 exit, the shell convention — not a broker crash.
  child.on("error", (err) => settle({ code: 127, signal: null, error: err.message }))
  child.on("exit", (code, signal) => settle({ code, signal }))

  return {
    pid: child.pid,
    /** Persistent output tap — survives sink attach/detach; used for turn-state scanning. */
    observe: (cb) => observers.push(cb),
    attachSink: (s) => { sink = s },
    detachSink: () => { sink = null },
    write: (buf) => { try { child.stdin.write(buf) } catch { /* stdin already ended */ } },
    closeStdin: () => { try { child.stdin.end() } catch { /* already closed */ } },
    term: () => { try { child.kill("SIGTERM") } catch { /* already gone */ } },
    kill: () => { try { child.kill("SIGKILL") } catch { /* already gone */ } },
    /** Fires cb(exitInfo) once — immediately if the child is already gone. */
    onExit: (cb) => { if (exited) cb(exited); else exitListeners.push(cb) },
    hasExited: () => exited !== null,
    exitInfo: () => exited,
    tailText: () => tail.toString("utf8"),
  }
}

module.exports = { createChild }
