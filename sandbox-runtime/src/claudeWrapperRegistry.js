// v2 broker registry: ONE child per wrapper connection — no shared engines, no session keys, no
// read-only attach, no replay buffer. The extension treats the wrapper as a plain claude spawn, so
// the broker's only job beyond a faithful relay is what happens when the wrapper DIES: drain the
// child (finish the turn, let the transcript flush — claudeWrapperDrain.js) instead of letting the
// panel's SIGKILL destroy the turn mid-flight.
const { createChild } = require("./claudeWrapperChild")
const { createTurnState } = require("./claudeWrapperTurnState")
const { startDrain } = require("./claudeWrapperDrain")
const { resumeSessionId } = require("./claudeWrapperHello")

const DEFAULT_CAP = Number(process.env.OYREN_CLAUDE_WRAPPER_MAX) || 8
const RESUME_WAIT_MS = 10000

function createRegistry({
  cap = DEFAULT_CAP, drainMs, spawnChild = createChild, log = (m) => console.log(m),
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout,
} = {}) {
  const active = new Set() // sessions with a live wrapper connection (what the cap counts)
  const draining = new Set() // disconnected children still flushing — cap-exempt, they're leaving

  /** Resume-race: `--resume <sid>` reads the session file a draining child with that same observed
   *  session id may still be WRITING. Hold the new spawn until it exits (capped at 10s). */
  function drainingFor(sid) {
    if (!sid) return null
    for (const d of draining) if (!d.child.hasExited() && d.turnState.getSessionId() === sid) return d
    return null
  }
  const waitForExit = (d) => new Promise((resolve) => {
    const t = setTimeoutImpl(resolve, RESUME_WAIT_MS)
    if (t && typeof t.unref === "function") t.unref()
    d.child.onExit(() => { clearTimeoutImpl(t); resolve() })
  })

  /** One wrapper connection's hello -> {ok:true, session} | {ok:false, error}. */
  async function claim(hello) {
    if (active.size >= cap) {
      return { ok: false, error: `wrapper cap (${cap}) reached — run claude directly instead` }
    }
    const blocking = drainingFor(resumeSessionId(hello.argv))
    if (blocking) await waitForExit(blocking)
    // Observability: argv + cwd + env KEY NAMES only — env values are session secrets, never logged.
    log(`[claude-wrapper] spawn wrapperPid=${hello.pid} argv=${JSON.stringify(hello.argv)} cwd=${hello.cwd} envKeys=${Object.keys(hello.env).sort().join(",")}`)
    const turnState = createTurnState()
    const child = spawnChild({ argv: hello.argv, cwd: hello.cwd, env: hello.env })
    child.observe((stream, buf) => { if (stream === "stdout") turnState.feedStdout(buf) })
    const session = {
      child,
      turnState,
      write: (buf) => { turnState.feedStdin(buf); child.write(buf) },
      attachSink: (sink) => child.attachSink(sink),
      /** The wrapper is gone ('s' frame or socket close). Frees the cap slot NOW — the reopened
       *  panel's fresh wrapper must never be refused because its predecessor is still flushing. */
      disconnect: () => {
        if (!active.delete(session)) return
        child.detachSink()
        if (child.hasExited()) return
        const entry = { child, turnState }
        draining.add(entry)
        startDrain({ child, turnState, drainMs, setTimeoutImpl, clearTimeoutImpl, onDone: () => draining.delete(entry) })
      },
      /** The child exited while still connected — plain cleanup, nothing left to drain. */
      release: () => { active.delete(session) },
    }
    child.onExit(() => active.delete(session))
    active.add(session)
    return { ok: true, session }
  }

  const size = () => active.size
  const drainingSize = () => draining.size
  /** Test/shutdown seam: SIGKILL everything this registry knows about. */
  function killAll() {
    for (const s of active) s.child.kill()
    for (const d of draining) d.child.kill()
    active.clear()
    draining.clear()
  }

  return { claim, size, drainingSize, killAll }
}

module.exports = { createRegistry, DEFAULT_CAP, RESUME_WAIT_MS }
