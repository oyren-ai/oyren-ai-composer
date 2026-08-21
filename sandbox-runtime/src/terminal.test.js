// Drives the real per-connection handler with a fake WebSocketServer and a recording PTY spawner —
// `ws` and `node-pty` (a native build) are exactly the two things a unit test must not need. What is
// pinned: the tmux command stays byte-identical for every client that does not ask otherwise, the
// plain shell is $SHELL -l (or /bin/bash) in the workdir, an unknown option value falls back to tmux,
// and the input/resize/exit wiring is the same on both paths.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const { setupTerminal } = require("./terminal")

class FakeWss extends EventEmitter {
  constructor() { super(); this.clients = new Set() }
}

function fakeSpawn(rec) {
  return (file, args, opts) => {
    const term = new EventEmitter()
    term.onData = (fn) => term.on("data", fn)
    term.onExit = (fn) => term.on("exit", fn)
    term.writes = []; term.resizes = []; term.killed = false
    term.write = (d) => term.writes.push(d)
    term.resize = (c, r) => term.resizes.push([c, r])
    term.kill = () => { term.killed = true }
    rec.calls.push({ file, args, opts, term })
    return term
  }
}

function fakeWs() {
  const ws = new EventEmitter()
  ws.sent = []; ws.closed = false
  ws.send = (d) => ws.sent.push(d)
  ws.close = () => { ws.closed = true }
  return ws
}

/** Boot the server with fakes, open one connection, return what got spawned. Tears down the ping timer. */
function connect({ shell, env = {} } = {}, fn) {
  const rec = { calls: [] }
  const wss = setupTerminal("/w", { spawn: fakeSpawn(rec), WebSocketServer: FakeWss, env })
  const ws = fakeWs()
  wss.emit("connection", ws, { url: "/terminal" }, shell === undefined ? undefined : { shell })
  try { return fn({ ws, ...rec.calls[0] }) } finally { wss.emit("close") }
}

test("default: the tmux attach command, argument for argument", () => {
  connect({}, ({ file, args, opts }) => {
    assert.equal(file, "tmux")
    assert.deepEqual(args, ["-u", "new-session", "-A", "-s", "main"])
    assert.equal(opts.cwd, "/w")
    assert.equal(opts.name, "xterm-256color")
    assert.deepEqual([opts.cols, opts.rows], [80, 24])
  })
})

test("an explicit tmux option spawns the same command as no option at all", () => {
  connect({ shell: "tmux" }, ({ file, args }) => {
    assert.equal(file, "tmux")
    assert.deepEqual(args, ["-u", "new-session", "-A", "-s", "main"])
  })
})

test("plain: $SHELL as a login shell, in the workdir, same PTY geometry", () => {
  connect({ shell: "plain", env: { SHELL: "/usr/bin/zsh" } }, ({ file, args, opts }) => {
    assert.equal(file, "/usr/bin/zsh")
    assert.deepEqual(args, ["-l"])
    assert.equal(opts.cwd, "/w")
    assert.equal(opts.name, "xterm-256color")
    assert.deepEqual([opts.cols, opts.rows], [80, 24])
    assert.equal(opts.env.SHELL, "/usr/bin/zsh") // the PTY inherits the env it was chosen from
  })
})

test("plain with no $SHELL falls back to /bin/bash", () => {
  connect({ shell: "plain", env: {} }, ({ file, args }) => {
    assert.equal(file, "/bin/bash")
    assert.deepEqual(args, ["-l"])
  })
})

test("an option value nobody defined (\"maybe\") is tmux, never some third thing", () => {
  connect({ shell: "maybe" }, ({ file }) => assert.equal(file, "tmux"))
})

test("input/resize reach the PTY, its exit closes the socket, the socket closing kills the PTY", () => {
  for (const shell of ["tmux", "plain"]) {
    connect({ shell }, ({ ws, term }) => {
      ws.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "ls\n" })))
      ws.emit("message", Buffer.from(JSON.stringify({ type: "resize", cols: 120, rows: 40 })))
      ws.emit("message", Buffer.from("not json")) // ignored, never thrown
      assert.deepEqual(term.writes, ["ls\n"], shell)
      assert.deepEqual(term.resizes, [[120, 40]], shell)
      term.emit("data", "hi"); assert.deepEqual(ws.sent, ["hi"], shell)
      term.emit("exit"); assert.equal(ws.closed, true, shell)
      ws.emit("close"); assert.equal(term.killed, true, shell)
    })
  }
})
