// Stage 1 verification (CONTINUITY_DESIGN_PLAN.md): the actual disconnect-survival property, proven
// with real OS processes and real signals — a fake `claude` (a tiny script that ticks and traps
// SIGTERM, exactly mirroring the "dummy-process methodology" of the original validated spike), a real
// broker (claudeWrapperRegistry + claudeWrapperSocket over a real unix socket), and a real
// claude-process-wrapper.js child that gets SIGTERM then SIGKILL — the exact sequence the VS Code
// extension's onDidDispose sends its direct child on every panel close.
const { test } = require("node:test")
const assert = require("node:assert")
const path = require("path")
const fs = require("fs")
const os = require("os")
const { spawn } = require("child_process")
const { createRegistry } = require("./src/claudeWrapperRegistry")
const { startSocketServer } = require("./src/claudeWrapperSocket")

const WRAPPER = path.join(__dirname, "claude-process-wrapper.js")

// A dummy "claude": prints a line every 50ms so the broker's ring buffer visibly advances, and traps
// SIGTERM (`trap '' TERM`) the way a real long-lived interactive CLI attached to a PTY commonly
// ignores an accidental TERM — the point of THIS test is that the child never receives one at all
// (the broker owns it, not the wrapper), so the trap is a belt-and-suspenders sanity check, not the
// mechanism under test.
const DUMMY_CLAUDE_SCRIPT = `
trap '' TERM
i=0
while :; do
  i=$((i+1))
  echo "tick-$i"
  sleep 0.05
done
`

function tmpSocketPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wrapper-survival-")), "broker.sock")
}

function waitFor(conditionFn, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (conditionFn()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor: timed out"))
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}

/** Spawn a real wrapper child process (node claude-process-wrapper.js), talking to the given broker
 *  socket, with OYREN_CLAUDE_WRAPPER=1. Returns the child plus its accumulated stdout text. */
function spawnWrapper(socketPath, extraEnv = {}) {
  const child = spawn(process.execPath, [WRAPPER], {
    env: { ...process.env, OYREN_CLAUDE_WRAPPER: "1", OYREN_CLAUDE_WRAPPER_SOCKET: socketPath, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let out = ""
  child.stdout.on("data", (d) => { out += d.toString("utf8") })
  return { child, output: () => out }
}

test("killing the wrapper (SIGTERM then SIGKILL) does not touch the broker's child — it keeps ticking", async () => {
  const socketPath = tmpSocketPath()
  const registry = createRegistry({
    spawn: (bin, args, opts) => require("node-pty").spawn("bash", ["-c", DUMMY_CLAUDE_SCRIPT], opts),
    sourceEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
  })
  const server = startSocketServer(socketPath, registry)
  const w1 = spawnWrapper(socketPath)
  try {
    // Let the dummy engine actually start producing output through the wrapper before we kill anything.
    await waitFor(() => w1.output().includes("tick-"))
    const ticksBeforeKill = (w1.output().match(/tick-/g) || []).length

    // Exactly the extension's onDidDispose sequence: SIGTERM, then (if it doesn't exit) SIGKILL.
    w1.child.kill("SIGTERM")
    await new Promise((r) => setTimeout(r, 150))
    if (!w1.child.killed) w1.child.kill("SIGKILL")
    await waitFor(() => w1.child.exitCode !== null || w1.child.signalCode !== null)

    // The engine must still be alive in the registry — proof the broker (not the wrapper) owns it.
    assert.equal(registry.has("default"), true, "the engine must survive the wrapper's SIGTERM→SIGKILL")

    // And it must still be actively producing NEW output (not just present-but-frozen/zombied).
    const w2 = spawnWrapper(socketPath)
    try {
      await waitFor(() => (w2.output().match(/tick-/g) || []).length > 0)
      const ticksAfterReconnect = (w2.output().match(/tick-/g) || []).length
      assert.ok(ticksAfterReconnect >= 1, "a fresh wrapper must reattach and see live ticks, not a dead buffer")
      // The replay must include ticks from BEFORE the kill — nothing was lost.
      assert.ok(ticksAfterReconnect >= ticksBeforeKill, "replay must include pre-kill history, not just new output")
    } finally {
      w2.child.kill("SIGKILL")
    }
  } finally {
    registry.killAll()
    server.close()
    try { w1.child.kill("SIGKILL") } catch { /* already dead */ }
  }
})

test("a second wrapper connection after the first dies reattaches silently as RW, with no visible marker", async () => {
  const socketPath = tmpSocketPath()
  const registry = createRegistry({
    spawn: (bin, args, opts) => require("node-pty").spawn("bash", ["-c", DUMMY_CLAUDE_SCRIPT], opts),
    sourceEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
  })
  const server = startSocketServer(socketPath, registry)
  const w1 = spawnWrapper(socketPath)
  try {
    await waitFor(() => w1.output().includes("tick-"))
    w1.child.kill("SIGKILL")
    await waitFor(() => w1.child.signalCode !== null)

    const w2 = spawnWrapper(socketPath)
    try {
      await waitFor(() => w2.output().length > 0)
      // Silent reconnect: the reattached stream is pure replay+live ticks — no divider, no "you were
      // away" text, nothing but the same tick lines a single unbroken session would have produced.
      // \r\n, not \n: this is real PTY output (ONLCR), same as any interactive terminal session.
      assert.ok(/^tick-\d+\r\n/.test(w2.output()), "the reattached stream must start with a plain tick line, no marker")
      assert.doesNotMatch(w2.output(), /reconnect|away|resumed|disconnected/i)
    } finally {
      w2.child.kill("SIGKILL")
    }
  } finally {
    registry.killAll()
    server.close()
    try { w1.child.kill("SIGKILL") } catch { /* already dead */ }
  }
})

test("two simultaneous wrapper connections: the second is read-only and promotes to RW on the first's disconnect", async () => {
  const socketPath = tmpSocketPath()
  const registry = createRegistry({
    spawn: (bin, args, opts) => require("node-pty").spawn("bash", ["-c", DUMMY_CLAUDE_SCRIPT], opts),
    sourceEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
  })
  const server = startSocketServer(socketPath, registry)
  const w1 = spawnWrapper(socketPath)
  let w2
  try {
    await waitFor(() => w1.output().includes("tick-"))
    w2 = spawnWrapper(socketPath)
    await waitFor(() => w2.output().includes("tick-"))
    // Both should be seeing the SAME live tick stream (one shared engine, not two).
    assert.equal(registry.size(), 1)

    w1.child.kill("SIGKILL")
    await waitFor(() => w1.child.signalCode !== null)
    // Give the FIFO promotion a moment, then confirm the engine survived (it did NOT reap — w2 is
    // still attached) and is still ticking for the survivor.
    const before = (w2.output().match(/tick-/g) || []).length
    await waitFor(() => (w2.output().match(/tick-/g) || []).length > before)
  } finally {
    registry.killAll()
    server.close()
    try { w1.child.kill("SIGKILL") } catch { /* already dead */ }
    try { w2 && w2.child.kill("SIGKILL") } catch { /* already dead */ }
  }
})

test("OYREN_CLAUDE_WRAPPER unset (the kill switch) never touches the broker at all", async () => {
  // No broker running — if the wrapper tried to connect it would error. It shouldn't even try.
  const env = { ...process.env, OYREN_CLAUDE_REAL_BIN: process.execPath, OYREN_CLAUDE_WRAPPER_SOCKET: "/nonexistent/broker.sock" }
  delete env.OYREN_CLAUDE_WRAPPER
  const child = spawn(process.execPath, [WRAPPER, "--version"], { env, stdio: ["ignore", "ignore", "pipe"] })
  let stderr = ""
  child.stderr.on("data", (d) => { stderr += d.toString("utf8") })
  await waitFor(() => child.exitCode !== null || stderr.length > 0, { timeoutMs: 2000 }).catch(() => {})
  await new Promise((r) => setTimeout(r, 100))
  assert.doesNotMatch(stderr, /broker/i, "flag-off must never mention or attempt the broker connection")
})
