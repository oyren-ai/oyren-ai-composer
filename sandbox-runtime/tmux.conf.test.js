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
    // 3.4 renders the valueless flip as `set-option -g mouse`, 3.5+ as `set-option mouse` (the
    // binding itself is session-scoped on purpose; see the conf). Both mean the same toggle.
    assert.match(keys, /-T prefix m\s+set-option (-g )?mouse/)

    assert.match(tmux("display", "-p", "#{?mouse,mouse:tmux,mouse:browser}").stdout, /mouse:tmux/)
    tmux("set", "-g", "mouse", "off")
    assert.match(tmux("display", "-p", "#{?mouse,mouse:tmux,mouse:browser}").stdout, /mouse:browser/)

    // The indicator has to actually fit when the bar IS up: the stock status-right is already
    // ~35 chars and status-right-length defaults to 40, which would truncate it away entirely.
    assert.match(value(tmux, "-g", "status-right"), /mouse:tmux,mouse:browser/)
    assert.ok(Number(value(tmux, "-g", "status-right-length")) >= 80)
  })
})

// tmux's stock status line is bg=green,fg=black — a full-width bright green band across the bottom
// of the pane. In the web terminal it lands directly above the dock and reads as a stray piece of
// Oyren's own UI, which is exactly what it is not.
test("the green status band is off, and prefix + T brings it back", { skip: !haveTmux }, () => {
  withServer("oyren-conf-status", (tmux) => {
    assert.strictEqual(value(tmux, "-g", "status"), "off")
    assert.match(tmux("list-keys", "-T", "prefix").stdout, /-T prefix T\s+set-option -g status/)
    tmux("set", "-g", "status", "on")
    assert.strictEqual(value(tmux, "-g", "status"), "on")
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

// ------------------------------------------------------------------ durability (tmux-resurrect)
// The options behind save/restore, resolved by a real tmux. @resurrect-dir is deliberately ABSENT:
// tmux-state.mjs sets it per session, and a value here would let a save land in another session's
// directory on a resumed droplet.
test("the resurrect options are resolved: capture contents, procfs strategy, never overwrite", { skip: !haveTmux }, () => {
  withServer("oyren-conf-resurrect", (tmux) => {
    assert.strictEqual(value(tmux, "-g", "@resurrect-capture-pane-contents"), "on")
    assert.strictEqual(value(tmux, "-g", "@resurrect-save-command-strategy"), "linux_procfs")
    assert.strictEqual(value(tmux, "-g", "@resurrect-never-overwrite"), "on")
    assert.strictEqual(value(tmux, "-g", "@resurrect-delete-backup-after"), "7")
    assert.strictEqual(value(tmux, "-g", "@oyren-conf-loaded"), "1")
    assert.strictEqual(value(tmux, "-g", "@resurrect-dir"), "")
  })
})

test("process restore stays viewers-only: no rule may replay a dev server or an agent CLI", { skip: !haveTmux }, () => {
  withServer("oyren-conf-processes", (tmux) => {
    const restore = value(tmux, "-g", "@resurrect-default-processes")
    assert.match(restore, /vim/)
    assert.doesNotMatch(restore, /\b(node|npm|pnpm|python|claude|codex)\b/)
    assert.strictEqual(value(tmux, "-g", "@resurrect-processes"), "")
  })
})

test("a client detach triggers a debounced save through tmux-state.mjs", { skip: !haveTmux }, () => {
  withServer("oyren-conf-detach-hook", (tmux) => {
    const hooks = tmux("show-hooks", "-g").stdout
    assert.match(hooks, /client-detached/)
    assert.match(hooks, /tmux-state\.mjs save --hook/)
  })
})

test("the vendored resurrect.tmux actually loads on this conf", { skip: !haveTmux }, () => {
  withServer("oyren-conf-plugin", (tmux) => {
    const plugin = path.join(__dirname, "tmux-plugins", "tmux-resurrect", "resurrect.tmux")
    const ran = tmux("run-shell", plugin)
    assert.strictEqual(ran.status, 0, ran.stderr)
    assert.notStrictEqual(value(tmux, "-g", "@resurrect-save-script-path"), "", "plugin left no save binding behind")
  })
})

test("OSC 8 hyperlinks pass through tmux to the outer terminal", { skip: !haveTmux }, () => {
  withServer("oyren-conf-hyperlinks", (tmux) => {
    assert.match(tmux("show", "-g", "terminal-features").stdout, /hyperlinks/)
  })
})

// The plugin load is guarded so a machine without the installed tree (tests, a stripped image)
// still gets every option above instead of a hard parse failure.
test("the plugin load line is guarded by an existence test", () => {
  const text = require("fs").readFileSync(CONF, "utf8")
  const line = text.split("\n").find((l) => l.includes("resurrect.tmux'"))
  assert.match(line, /^if-shell 'test -r/)
})
