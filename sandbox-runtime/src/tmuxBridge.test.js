// Drives handleTmuxBridge with the shared drive() req/res fakes and a recording tmux exec — no real
// tmux server, no real systemctl assertions (the `unit` field's value is tmuxUnit.js's business; here
// we only pin that it is surfaced). What is pinned: the exact tmux argv for list/capture/send, the
// pane-record normalization, the stale-pane guard's 400/409/404 behavior, and secret redaction.
process.env.SESSION_TOKEN = "tok" // config reads this at require-time
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { drive } = require("./agentFakes")
const { handleTmuxBridge, redactSecrets, __setExec } = require("./tmuxBridge")

const T = "\t"
const LIST_LINES = [
  ["main", "0", "0", "%0", "bash", "/w", "shell"].join(T),
  ["main", "5", "1", "%12", "node", "/w/repo", "✳ claude worker"].join(T),
  ["main", "5", "2", "%13", "claude", "/w/repo", "OYR-0042 fix" + T + "tabbed"].join(T),
].join("\n") + "\n"

/** Recording exec: every tmux argv lands in calls; responses come from the byCmd map (keyed on
 *  args[0]) — a string resolves, an Error rejects. */
function fakeExec(byCmd = {}) {
  const calls = []
  __setExec(async (args) => {
    calls.push(args)
    const r = byCmd[args[0]]
    if (r instanceof Error) throw r
    return r ?? ""
  })
  return calls
}

test("every endpoint 401s without the session token", async () => {
  fakeExec()
  for (const [method, url] of [
    ["GET", "/tmux/panes"],
    ["GET", "/tmux/panes/%2512/screen"],
    ["POST", "/tmux/panes/%2512/input"],
  ]) {
    const res = await drive(handleTmuxBridge, { method, url })
    assert.equal(res.status, 401, url)
  }
})

test("GET /tmux/panes: exact tmux argv, normalized records, likelyAgent from command or title", async () => {
  const calls = fakeExec({ "list-panes": LIST_LINES })
  const res = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes?token=tok" })
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [["list-panes", "-a", "-F", ["#{session_name}", "#{window_index}", "#{pane_index}", "#{pane_id}", "#{pane_current_command}", "#{pane_current_path}", "#{pane_title}"].join(T)]])
  const body = JSON.parse(res.body())
  assert.ok("unit" in body)
  assert.deepEqual(body.panes[0], { id: "%0", target: "main:0.0", command: "bash", cwd: "/w", title: "shell", likelyAgent: false, mode: "tty" })
  assert.equal(body.panes[1].likelyAgent, true) // "claude" in the title, command is just node
  assert.equal(body.panes[1].target, "main:5.1")
  assert.equal(body.panes[2].likelyAgent, true) // "claude" as the command itself
  assert.equal(body.panes[2].title, "OYR-0042 fix" + T + "tabbed") // a tab inside the title survives
})

test("GET /tmux/panes: tmux failure is 503 with the unit state surfaced", async () => {
  fakeExec({ "list-panes": new Error("no server running on /tmp/tmux-1000/default") })
  const res = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes?token=tok" })
  assert.equal(res.status, 503)
  const body = JSON.parse(res.body())
  assert.equal(body.error, "tmux unavailable")
  assert.match(body.detail, /no server running/)
  assert.ok("unit" in body)
})

test("GET screen: capture-pane argv with the default 200 lines; numeric pane ids normalize to %N", async () => {
  const calls = fakeExec({ "capture-pane": "hello\nworld\n" })
  const res = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes/12/screen?token=tok" })
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [["capture-pane", "-p", "-J", "-S", "-200", "-t", "%12"]])
  const body = JSON.parse(res.body())
  assert.equal(body.screen, "hello\nworld\n")
  assert.equal(body.redactions, 0)
})

test("GET screen: lines is validated and reaches -S; junk and out-of-range are 400", async () => {
  const calls = fakeExec({ "capture-pane": "" })
  const ok = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes/%2512/screen?token=tok&lines=1000" })
  assert.equal(ok.status, 200)
  assert.deepEqual(calls[0], ["capture-pane", "-p", "-J", "-S", "-1000", "-t", "%12"])
  for (const lines of ["0", "5001", "abc", "-3"]) {
    const bad = await drive(handleTmuxBridge, { method: "GET", url: `/tmux/panes/%2512/screen?token=tok&lines=${lines}` })
    assert.equal(bad.status, 400, `lines=${lines}`)
  }
  assert.equal(calls.length, 1) // none of the rejects reached tmux
})

test("GET screen: secrets on the screen come back redacted, with a count", async () => {
  fakeExec({ "capture-pane": "export GH_TOKEN=ghp_abcdefghij0123456789ABCD\ncurl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc12345'\npassword=hunter2secret\n" })
  const res = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes/%2512/screen?token=tok" })
  const body = JSON.parse(res.body())
  assert.ok(!body.screen.includes("ghp_abcdefghij"), "gh token gone")
  assert.ok(!body.screen.includes("hunter2secret"), "password value gone")
  assert.match(body.screen, /GH_TOKEN=\[redacted\]/) // the assignment shape survives
  assert.match(body.screen, /password=\[redacted\]/)
  assert.ok(body.redactions >= 3, `redactions=${body.redactions}`)
})

test("GET screen: a dead pane is 404, other capture failures 503", async () => {
  fakeExec({ "capture-pane": new Error("can't find pane: %99") })
  const gone = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes/%2599/screen?token=tok" })
  assert.equal(gone.status, 404)
  fakeExec({ "capture-pane": new Error("server exited unexpectedly") })
  const broken = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes/%2512/screen?token=tok" })
  assert.equal(broken.status, 503)
})

test("pane id shapes: %N and N are accepted, anything else is 400 before tmux is touched", async () => {
  const calls = fakeExec({ "capture-pane": "" })
  for (const bad of ["abc", "%25x", "..", "-t", "%2512;kill-server"]) {
    const res = await drive(handleTmuxBridge, { method: "GET", url: `/tmux/panes/${bad}/screen?token=tok` })
    assert.equal(res.status, 400, bad)
  }
  assert.equal(calls.length, 0)
})

test("POST input: happy path types literally then presses Enter, logs nothing but metadata", async () => {
  const calls = fakeExec({ "list-panes": LIST_LINES, "send-keys": "" })
  const res = await drive(handleTmuxBridge, {
    method: "POST",
    url: "/tmux/panes/%2513/input?token=tok",
    body: JSON.stringify({ text: "-hello worker", enter: true, expectedCommand: "claude" }),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(calls.slice(1), [
    ["send-keys", "-t", "%13", "-l", "--", "-hello worker"], // -- so leading "-" text can't become flags
    ["send-keys", "-t", "%13", "Enter"],
  ])
  const body = JSON.parse(res.body())
  assert.equal(body.ok, true)
  assert.equal(body.pane.command, "claude")
})

test("POST input: enter:false sends no Enter keypress", async () => {
  const calls = fakeExec({ "list-panes": LIST_LINES, "send-keys": "" })
  await drive(handleTmuxBridge, {
    method: "POST",
    url: "/tmux/panes/%2513/input?token=tok",
    body: JSON.stringify({ text: "draft", expectedCommand: "claude" }),
  })
  assert.deepEqual(calls.slice(1), [["send-keys", "-t", "%13", "-l", "--", "draft"]])
})

test("POST input: the stale-pane guard is mandatory — no expectations, no typing", async () => {
  const calls = fakeExec({ "list-panes": LIST_LINES, "send-keys": "" })
  const res = await drive(handleTmuxBridge, {
    method: "POST",
    url: "/tmux/panes/%2513/input?token=tok",
    body: JSON.stringify({ text: "yolo", enter: true }),
  })
  assert.equal(res.status, 400)
  assert.equal(calls.length, 0)
})

test("POST input: a pane whose command changed since observation is 409 and untouched", async () => {
  const calls = fakeExec({ "list-panes": LIST_LINES, "send-keys": "" })
  const res = await drive(handleTmuxBridge, {
    method: "POST",
    url: "/tmux/panes/%2513/input?token=tok",
    body: JSON.stringify({ text: "hi", expectedCommand: "vim" }), // pane %13 now runs claude
  })
  assert.equal(res.status, 409)
  const body = JSON.parse(res.body())
  assert.deepEqual({ field: body.field, expected: body.expected, actual: body.actual }, { field: "command", expected: "vim", actual: "claude" })
  assert.ok(!calls.some((c) => c[0] === "send-keys"))
})

test("POST input: a changed title trips the guard too", async () => {
  fakeExec({ "list-panes": LIST_LINES, "send-keys": "" })
  const res = await drive(handleTmuxBridge, {
    method: "POST",
    url: "/tmux/panes/%2512/input?token=tok",
    body: JSON.stringify({ text: "hi", expectedTitle: "something else" }),
  })
  assert.equal(res.status, 409)
})

test("POST input: a vanished pane is 404; junk body / non-string text are 400", async () => {
  fakeExec({ "list-panes": LIST_LINES, "send-keys": "" })
  const gone = await drive(handleTmuxBridge, {
    method: "POST",
    url: "/tmux/panes/%2599/input?token=tok",
    body: JSON.stringify({ text: "hi", expectedCommand: "claude" }),
  })
  assert.equal(gone.status, 404)
  const junk = await drive(handleTmuxBridge, { method: "POST", url: "/tmux/panes/%2513/input?token=tok", body: "not json" })
  assert.equal(junk.status, 400)
  const noText = await drive(handleTmuxBridge, { method: "POST", url: "/tmux/panes/%2513/input?token=tok", body: JSON.stringify({ expectedCommand: "claude" }) })
  assert.equal(noText.status, 400)
})

test("method mismatches are 405, unknown /tmux paths 404", async () => {
  fakeExec({ "list-panes": LIST_LINES })
  assert.equal((await drive(handleTmuxBridge, { method: "POST", url: "/tmux/panes?token=tok" })).status, 405)
  assert.equal((await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes/%2513/input?token=tok" })).status, 405)
  assert.equal((await drive(handleTmuxBridge, { method: "GET", url: "/tmux/what?token=tok" })).status, 404)
})

test("redactSecrets: clean text passes through untouched", () => {
  const { text, count } = redactSecrets("just a normal build log\nnpm ok\n")
  assert.equal(text, "just a normal build log\nnpm ok\n")
  assert.equal(count, 0)
})
