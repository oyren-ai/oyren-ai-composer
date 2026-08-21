// The /terminal leg of the upgrade dispatcher: the token gate, and the one query knob it forwards to
// the PTY server — `tmux=off` asks for a plain login shell. Everything else about the socket is
// terminal.js's business (terminal.test.js), so the WebSocketServer here is a recorder, not a fake.
process.env.SESSION_TOKEN = "tok" // config reads this at require-time
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createUpgradeHandler } = require("./upgrade")

function fakeTermWss() {
  const calls = []
  return {
    calls,
    handleUpgrade(req, socket, head, cb) { cb({ fake: "ws" }) },
    emit(...args) { calls.push(args) },
  }
}

function fakeSocket() {
  const s = { written: "", destroyed: false }
  s.write = (d) => { s.written += d }
  s.destroy = () => { s.destroyed = true }
  return s
}

function upgrade(url) {
  const termWss = fakeTermWss()
  const socket = fakeSocket()
  const req = { url }
  createUpgradeHandler({ termWss, routes: null, supervisor: {} })(req, socket, Buffer.alloc(0))
  return { termWss, socket, req }
}

test("/terminal?token=… reaches the PTY server asking for tmux — the default every existing client gets", () => {
  const { termWss, req } = upgrade("/terminal?token=tok")
  assert.equal(termWss.calls.length, 1)
  const [event, ws, gotReq, opts] = termWss.calls[0]
  assert.equal(event, "connection")
  assert.deepEqual(ws, { fake: "ws" })
  assert.equal(gotReq, req)
  assert.deepEqual(opts, { shell: "tmux" })
})

test("tmux=off asks for the plain login shell", () => {
  const { termWss } = upgrade("/terminal?token=tok&tmux=off")
  assert.deepEqual(termWss.calls[0][3], { shell: "plain" })
})

test("any other tmux value (on, maybe, empty) keeps tmux — only an explicit off opts out", () => {
  for (const v of ["on", "maybe", "", "OFF"]) {
    const { termWss } = upgrade(`/terminal?token=tok&tmux=${v}`)
    assert.deepEqual(termWss.calls[0][3], { shell: "tmux" }, `tmux=${v}`)
  }
})

test("the token gate is untouched by the new knob: wrong token ⇒ 401, no connection", () => {
  const { termWss, socket } = upgrade("/terminal?token=nope&tmux=off")
  assert.equal(termWss.calls.length, 0)
  assert.match(socket.written, /^HTTP\/1\.1 401 /)
  assert.equal(socket.destroyed, true)
})
