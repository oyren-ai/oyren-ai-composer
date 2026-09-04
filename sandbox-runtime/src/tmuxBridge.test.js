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
// session, window, paneIdx, id, command, cwd, width, height, active, zoomed, title
const LIST_LINES = [
  ["main", "0", "0", "%0", "bash", "/w", "80", "24", "1", "0", "shell"].join(T),
  ["main", "5", "1", "%12", "node", "/w/repo", "120", "40", "0", "0", "claude worker"].join(T),
  ["main", "5", "2", "%13", "claude", "/w/repo", "200", "50", "0", "1", "OYR-0042 fix" + T + "tabbed"].join(T),
  ["main", "6", "0", "%14", "sh", "/w/repo", "80", "24", "0", "0", "✳ OYR-0042 collapse nextDb"].join(T), // pnpm-shim Claude Code: only the ✳ gives it away
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
  assert.deepEqual(calls, [["list-panes", "-a", "-F", [
    "#{session_name}", "#{window_index}", "#{pane_index}", "#{pane_id}",
    "#{pane_current_command}", "#{pane_current_path}",
    "#{pane_width}", "#{pane_height}", "#{pane_active}", "#{window_zoomed_flag}",
    "#{pane_title}",
  ].join(T)]])
  const body = JSON.parse(res.body())
  assert.ok("unit" in body)
  assert.deepEqual(body.panes[0], {
    id: "%0", target: "main:0.0", command: "bash", cwd: "/w", title: "shell",
    width: 80, height: 24, active: true, zoomed: false, likelyAgent: false, mode: "tty",
  })
  assert.equal(body.panes[1].likelyAgent, true) // "claude" in the title, command is just node
  assert.equal(body.panes[1].target, "main:5.1")
  assert.equal(body.panes[2].likelyAgent, true) // "claude" as the command itself
  assert.equal(body.panes[2].title, "OYR-0042 fix" + T + "tabbed") // a tab inside the title survives
  assert.equal(body.panes[3].likelyAgent, true) // command "sh", no CLI name — the ✳ title marker decides
})

test("pane geometry: the character grid, active and zoomed flags ride on every record", async () => {
  fakeExec({ "list-panes": LIST_LINES })
  const res = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes?token=tok" })
  const { panes } = JSON.parse(res.body())
  assert.deepEqual(panes.map((p) => [p.width, p.height]), [[80, 24], [120, 40], [200, 50], [80, 24]])
  assert.deepEqual(panes.map((p) => p.active), [true, false, false, false])
  assert.deepEqual(panes.map((p) => p.zoomed), [false, false, true, false])
})

test("pane geometry: a tab in the title never shifts the geometry fields (title stays last)", async () => {
  fakeExec({ "list-panes": LIST_LINES })
  const res = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes?token=tok" })
  const tabbed = JSON.parse(res.body()).panes[2]
  assert.equal(tabbed.title, "OYR-0042 fix" + T + "tabbed")
  assert.deepEqual([tabbed.width, tabbed.height, tabbed.zoomed], [200, 50, true])
})

test("pane geometry: unparseable dimensions degrade to 0 rather than NaN in the JSON", async () => {
  fakeExec({ "list-panes": ["main", "0", "0", "%0", "bash", "/w", "", "oops", "", "", "t"].join(T) + "\n" })
  const res = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes?token=tok" })
  const p = JSON.parse(res.body()).panes[0]
  assert.deepEqual([p.width, p.height], [0, 0]) // JSON has no NaN — a consumer would get null and break its layout
  assert.deepEqual([p.active, p.zoomed], [false, false])
})

test("pane geometry rides on the single-pane detail view too", async () => {
  fakeExec({ "list-panes": LIST_LINES, "capture-pane": "hi\n" })
  const res = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes/%2512?token=tok" })
  const { pane } = JSON.parse(res.body())
  assert.deepEqual([pane.width, pane.height, pane.active, pane.zoomed], [120, 40, false, false])
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

test("GET screen: capture-pane argv with the default 200 lines", async () => {
  const calls = fakeExec({ "capture-pane": "hello\nworld\n" })
  const res = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes/%2512/screen?token=tok" })
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

test("pane id shapes: only %N is accepted — bare digits (pane INDEXES, a different namespace) and junk are 400 before tmux is touched", async () => {
  const calls = fakeExec({ "capture-pane": "" })
  for (const bad of ["12", "0", "abc", "%25x", "..", "-t", "%2512;kill-server"]) {
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

// OYR-0022: the look-before-you-type call and the cwd guard.
test("GET /tmux/panes/:id: pane record plus a short redacted preview, dead pane 404", async () => {
  const calls = fakeExec({ "list-panes": LIST_LINES, "capture-pane": "building...\ntoken=abc123secretvalue\n" })
  const res = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes/%2513?token=tok" })
  assert.equal(res.status, 200)
  assert.deepEqual(calls[1], ["capture-pane", "-p", "-J", "-S", "-15", "-t", "%13"])
  const body = JSON.parse(res.body())
  assert.equal(body.pane.command, "claude")
  assert.equal(body.pane.cwd, "/w/repo")
  assert.match(body.preview, /token=\[redacted\]/) // the preview is redacted like /screen
  assert.ok("unit" in body)
  fakeExec({ "list-panes": LIST_LINES })
  const gone = await drive(handleTmuxBridge, { method: "GET", url: "/tmux/panes/%2599?token=tok" })
  assert.equal(gone.status, 404)
})

test("POST input: a changed cwd trips the guard, but expectedCwd alone can NOT carry it (weakest identity signal)", async () => {
  const calls = fakeExec({ "list-panes": LIST_LINES, "send-keys": "" })
  const moved = await drive(handleTmuxBridge, {
    method: "POST",
    url: "/tmux/panes/%2513/input?token=tok",
    body: JSON.stringify({ text: "hi", expectedCommand: "claude", expectedCwd: "/somewhere/else" }),
  })
  assert.equal(moved.status, 409)
  assert.equal(JSON.parse(moved.body()).field, "cwd")
  const cwdOnly = await drive(handleTmuxBridge, {
    method: "POST",
    url: "/tmux/panes/%2513/input?token=tok",
    body: JSON.stringify({ text: "hi", expectedCwd: "/w/repo" }), // matches — still refused
  })
  assert.equal(cwdOnly.status, 400)
  assert.ok(!calls.some((c) => c[0] === "send-keys"))
})

test("POST input: text beyond 64KB is 413 before any tmux call", async () => {
  const calls = fakeExec({ "list-panes": LIST_LINES, "send-keys": "" })
  const res = await drive(handleTmuxBridge, {
    method: "POST",
    url: "/tmux/panes/%2513/input?token=tok",
    body: JSON.stringify({ text: "x".repeat(64 * 1024 + 1), expectedCommand: "claude" }),
  })
  assert.equal(res.status, 413)
  assert.equal(calls.length, 0)
})

test("redactSecrets: clean text passes through untouched", () => {
  const { text, count } = redactSecrets("just a normal build log\nnpm ok\n")
  assert.equal(text, "just a normal build log\nnpm ok\n")
  assert.equal(count, 0)
})
