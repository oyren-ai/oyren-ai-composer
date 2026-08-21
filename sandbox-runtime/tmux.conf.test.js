const { test } = require("node:test")
const assert = require("node:assert")
const path = require("path")
const { spawnSync } = require("child_process")

const CONF = path.join(__dirname, "tmux.conf")

// Asserting on the text of the file would pass for a line tmux silently rejects, and every setting
// here exists to survive a container rebuild — a typo that only shows up as "paste is weird again"
// three sandboxes later. So load the file into a REAL tmux on a private socket and ask tmux what it
// resolved. Each test gets its own socket name so they cannot see each other's server.
const haveTmux = spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0

function withServer(sock, fn) {
  const tmux = (...args) => spawnSync("tmux", ["-L", sock, ...args], { encoding: "utf8" })
  const started = spawnSync("tmux", ["-f", CONF, "-L", sock, "new-session", "-d", "-s", "t", "sleep", "30"], {
    encoding: "utf8",
  })
  assert.strictEqual(started.status, 0, `tmux refused the config: ${started.stderr}`)
  try {
    return fn(tmux)
  } finally {
    spawnSync("tmux", ["-L", sock, "kill-server"], { encoding: "utf8" })
  }
}

// `show -g <name>` prints "<name> <value>"; server options need -s.
const value = (tmux, flag, name) => (tmux("show", flag, name).stdout || "").trim().slice(name.length).trim()

test("tmux accepts the file — a rejected line would leave the sandbox on stock defaults", { skip: !haveTmux }, () => {
  withServer("oyren-conf-parse", (tmux) => {
    assert.strictEqual(tmux("has-session", "-t", "t").status, 0)
  })
})

test("Esc is not held for half a second — the 500ms default makes an ESC inside a paste ambiguous", { skip: !haveTmux }, () => {
  withServer("oyren-conf-escape", (tmux) => {
    assert.strictEqual(value(tmux, "-s", "escape-time"), "0")
  })
})

test("the terminal contract is stated, not inferred — bpaste is what brackets a multi-line paste", { skip: !haveTmux }, () => {
  withServer("oyren-conf-features", (tmux) => {
    const features = tmux("show", "-g", "terminal-features").stdout
    assert.match(features, /bpaste/)
    assert.match(features, /RGB/)
    assert.strictEqual(value(tmux, "-g", "default-terminal"), "tmux-256color")
  })
})

test("the mouse starts with tmux, so the browser wheel can reach scrollback", { skip: !haveTmux }, () => {
  withServer("oyren-conf-mouse-on", (tmux) => {
    assert.strictEqual(value(tmux, "-g", "mouse"), "on")
  })
})

// On macOS xterm.js has no shift-drag bypass (shouldForceSelection is
// `isMac ? altKey && macOptionClickForcesSelection : shiftKey`, and that option is unset in
// oyren-ai-next), so turning the mouse off is the ONLY way a Mac user gets a native selection back.
// If this binding ever disappears they are stuck with no way to copy out of the terminal.
test("prefix + m hands the mouse back to the browser, and the status line says so", { skip: !haveTmux }, () => {
  withServer("oyren-conf-mouse-toggle", (tmux) => {
    const keys = tmux("list-keys", "-T", "prefix").stdout
    assert.match(keys, /-T prefix m\s+set-option -g mouse/)

    assert.match(tmux("display", "-p", "#{?mouse,mouse:tmux,mouse:browser}").stdout, /mouse:tmux/)
    tmux("set", "-g", "mouse", "off")
    assert.match(tmux("display", "-p", "#{?mouse,mouse:tmux,mouse:browser}").stdout, /mouse:browser/)

    // The indicator has to actually fit: the stock status-right is already ~35 chars and
    // status-right-length defaults to 40, which would truncate it away entirely.
    assert.match(value(tmux, "-g", "status-right"), /mouse:tmux,mouse:browser/)
    assert.ok(Number(value(tmux, "-g", "status-right-length")) >= 80)
  })
})

test("prefix + ] pastes bracketed, so a multi-line buffer is not replayed as keystrokes", { skip: !haveTmux }, () => {
  withServer("oyren-conf-paste", (tmux) => {
    assert.match(tmux("list-keys", "-T", "prefix").stdout, /-T prefix \]\s+paste-buffer -p/)
  })
})

test("a tmux-side copy is offered to the browser clipboard over OSC 52", { skip: !haveTmux }, () => {
  withServer("oyren-conf-clipboard", (tmux) => {
    assert.strictEqual(value(tmux, "-s", "set-clipboard"), "on")
  })
})

test("scrollback outlives a chatty agent, and the session keeps the GitHub token current", { skip: !haveTmux }, () => {
  withServer("oyren-conf-env", (tmux) => {
    assert.ok(Number(value(tmux, "-g", "history-limit")) >= 50000)
    const env = tmux("show", "-g", "update-environment").stdout
    assert.match(env, /GITHUB_TOKEN/)
    assert.match(env, /GH_TOKEN/)
  })
})
