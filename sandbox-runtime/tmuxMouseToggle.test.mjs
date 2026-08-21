// Tests for `prefix + m`, the mouse toggle in tmux.conf.
//
// Every test runs a REAL tmux server loaded with the REAL config on a private socket, so what is
// asserted is what the image ships. What is NOT simulated is the keystroke itself: dispatching a
// prefix key needs a client attached to a pty, and `send-keys` writes to the pane's program rather
// than to tmux's key handling, so it never reaches the binding. Instead the command tmux actually
// registered for `m` is read back out of `list-keys` and run — config-driven, so changing the
// binding changes what these tests execute.
//
// The case that matters is a session carrying its own `mouse off`, which is what zed-shell pins on
// every terminal tab it opens for Zed. A session-level option outranks the global one, so the old
// `set -g mouse` binding flipped a value those sessions never read and `prefix + m` did nothing at
// all there — the one place a Mac user, with no shift-drag bypass, most needs it.
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const CONF = fileURLToPath(new URL("./tmux.conf", import.meta.url))
const hasTmux = (() => {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

let socket, dir
const tmux = (...args) => execFileSync("tmux", ["-S", socket, ...args], { encoding: "utf8" }).trim()

/** The value tmux itself resolves for a session, after session-over-global precedence.
 *  Via a format rather than `show-options -v`, which reports only a session's OWN value and prints
 *  nothing when the session is inheriting — the same resolution the status line does. */
const mouseFor = (session) => tmux("display-message", "-t", session, "-p", "#{?mouse,on,off}")

/** The command tmux registered for `prefix + m`, minus the display-message half. */
const boundCommand = () => {
  const line = tmux("list-keys", "-T", "prefix", "m")
  const body = line.slice(line.indexOf(" m ") + 3)
  return body.split(" \\;")[0].trim().split(/\s+/)
}

/** Run that command against one session — what tmux does implicitly for the focused client. */
const runBinding = (session) => {
  const [cmd, ...rest] = boundCommand()
  tmux(cmd, "-t", session, ...rest)
}

before(() => {
  if (!hasTmux) return
  dir = mkdtempSync(join(tmpdir(), "tmux-mouse-"))
  socket = join(dir, "sock")
  execFileSync("tmux", ["-S", socket, "-f", CONF, "new-session", "-d", "-s", "boot"])
})

after(() => {
  if (!hasTmux) return
  try {
    tmux("kill-server")
  } catch {
    /* already gone */
  }
  rmSync(dir, { recursive: true, force: true })
})

test("the binding is session-scoped — the regression this fixes", { skip: !hasTmux }, () => {
  const cmd = boundCommand()
  assert.deepEqual(cmd, ["set-option", "mouse"])
  assert.ok(!cmd.includes("-g"), "a -g toggle cannot override the session-level value zed-shell sets")
})

test("the config default is mouse on — the browser wheel must reach tmux history", { skip: !hasTmux }, () => {
  tmux("new-session", "-d", "-s", "plain")
  assert.equal(mouseFor("plain"), "on")
})

test("the toggle flips a session that just inherits the global default", { skip: !hasTmux }, () => {
  tmux("new-session", "-d", "-s", "inherits")
  assert.equal(mouseFor("inherits"), "on")
  runBinding("inherits")
  assert.equal(mouseFor("inherits"), "off")
  runBinding("inherits")
  assert.equal(mouseFor("inherits"), "on")
})

test("the bug: a global toggle cannot move a session pinned 'mouse off'", { skip: !hasTmux }, () => {
  tmux("new-session", "-d", "-s", "oldway")
  tmux("set-option", "-t", "oldway", "mouse", "off") // exactly what zed-shell does
  tmux("set-option", "-g", "mouse") // exactly what the old binding did
  assert.equal(mouseFor("oldway"), "off", "session value shadows the global — this was the bug")
  tmux("set-option", "-g", "mouse", "on") // leave the global as the config had it
})

test("the fix: the toggle overrides a session pinned 'mouse off'", { skip: !hasTmux }, () => {
  tmux("new-session", "-d", "-s", "zedlike")
  tmux("set-option", "-t", "zedlike", "mouse", "off")
  assert.equal(mouseFor("zedlike"), "off")
  runBinding("zedlike")
  assert.equal(mouseFor("zedlike"), "on")
})

test("toggling one session leaves the others alone", { skip: !hasTmux }, () => {
  tmux("new-session", "-d", "-s", "a")
  tmux("new-session", "-d", "-s", "b")
  runBinding("a")
  assert.equal(mouseFor("a"), "off")
  assert.equal(mouseFor("b"), "on")
})

test("the status line reports whichever side owns the mouse", { skip: !hasTmux }, () => {
  const owner = (s) => tmux("display-message", "-t", s, "-p", "#{?mouse,mouse:tmux,mouse:browser}")
  tmux("new-session", "-d", "-s", "status")
  assert.equal(owner("status"), "mouse:tmux")
  runBinding("status")
  assert.equal(owner("status"), "mouse:browser")
})
