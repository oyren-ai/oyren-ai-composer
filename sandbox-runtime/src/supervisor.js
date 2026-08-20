// Supervises the user's app. Two modes converge on the same `exposedPort` the proxy routes to:
//  - manual:  the human/agent runs the app in the tmux terminal; `expose(port)` only records it.
//  - managed: `start()` spawns the app via the resolved start command; `restart()` re-spawns it.
// On child crash the container stays up (only `state` flips to "crashed"). Never wipes /workspace.
const net = require("net")
const { spawn } = require("child_process")
const { pipeChildOutput } = require("./logBuffer")
const { appEnv } = require("./appEnv")

/** Resolve true if something is accepting TCP connections on `port` within `timeoutMs`. */
function tcpProbe(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1")
    const done = (ok) => { sock.destroy(); resolve(ok) }
    sock.setTimeout(timeoutMs)
    sock.once("connect", () => done(true))
    sock.once("timeout", () => done(false))
    sock.once("error", () => done(false))
  })
}

class Supervisor {
  constructor({ workdir, mode = "prod", resolve, spawnFn = spawn, probe = tcpProbe } = {}) {
    this.workdir = workdir
    this.mode = mode
    this.resolve = resolve
    this.spawnFn = spawnFn
    this.probe = probe
    this.state = "idle" // idle | starting | running | crashed
    this.exposedPort = null
    this.managed = false
    this.child = null
    this.error = null
  }

  /** Record the port the proxy should forward `/` to (manual mode: the app is run by the user). */
  expose(port) {
    this.exposedPort = Number(port)
    this.error = null
    return this.statusSync()
  }

  /** Spawn (or re-spawn) the user's app on the exposed port via the resolved start command. */
  async start(port) {
    if (port) this.exposedPort = Number(port)
    if (!this.exposedPort) { this.error = "no port exposed"; return this.statusSync() }
    await this.stop()
    const cmd = await this.resolve.resolveField(this.workdir, "start", this.mode)
    if (!cmd) { this.state = "crashed"; this.error = "no start command in oyren manifest"; return this.statusSync() }
    this.managed = true
    this.state = "starting"
    this.error = null
    // Scrub session-control secrets (SESSION_TOKEN/CONTROL_TOKEN/GITHUB_TOKEN) so user code
    // can't inherit them; the app only needs the user-visible env plus its port.
    const env = { ...appEnv(), PORT: String(this.exposedPort) }
    // Piped (not "inherit") so the app's output can be teed into the log buffer for /_oyren/logs;
    // pipeChildOutput() forwards every chunk straight through to this process's own stdout/stderr
    // first, so platform-level log capture (DO's runtime logs) sees exactly what it always did.
    this.child = this.spawnFn("bash", ["-lc", cmd], { cwd: this.workdir, env, stdio: ["ignore", "pipe", "pipe"] })
    pipeChildOutput(this.child)
    this.child.on("exit", (code) => {
      this.child = null
      if (this.state !== "idle") { this.state = "crashed"; this.error = `app exited (code ${code})` }
    })
    this.state = (await this.probe(this.exposedPort)) ? "running" : "starting"
    return this.statusSync()
  }

  /** Restart only works on a managed child — manual apps must use `start` first. */
  async restart() {
    if (!this.managed) return { ...this.statusSync(), error: "not managed — run `oyren start` to enable restart" }
    return this.start()
  }

  async stop() {
    if (this.child) { try { this.child.kill("SIGTERM") } catch {} this.child = null }
    this.state = "idle"
    return this.statusSync()
  }

  statusSync() {
    return { state: this.state, exposedPort: this.exposedPort, managed: this.managed, error: this.error }
  }

  /** Status enriched with a live TCP probe of the exposed port (whether anything is listening). */
  async status() {
    const listening = this.exposedPort ? await this.probe(this.exposedPort) : false
    return { ...this.statusSync(), listening }
  }
}

module.exports = { Supervisor, tcpProbe }
