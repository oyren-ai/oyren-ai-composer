// Tests for the Zed terminal-panel shell picker (zed-shell) and its switch (zed-term).
//
// Both are shell scripts that end in `exec`, so they are tested the way Zed actually runs them:
// spawned with a stub `tmux` and a stub login shell on PATH, each recording its argv to a log. The
// assertions are about what the panel would really get — which mode won, which tmux session was
// created or reclaimed, and that `mouse off` is applied before anything attaches.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ZED_SHELL = join(HERE, "zed-shell")
const ZED_TERM = join(HERE, "zed-term")

/** A stub `tmux` that logs every invocation and answers the two queries zed-shell makes.
 *  STUB_SESSIONS: `list-sessions -F '#{session_name} #{session_attached}'` output.
 *  STUB_EXISTING: space-separated session names `has-session` should succeed for. */
const TMUX_STUB = `#!/bin/sh
printf 'tmux %s\\n' "$*" >> "$STUB_LOG"
[ "$1" = "-u" ] && shift
case "$1" in
  list-sessions) [ -n "\${STUB_SESSIONS:-}" ] && printf '%s\\n' "$STUB_SESSIONS" ;;
  has-session)   case " \${STUB_EXISTING:-} " in *" $3 "*) exit 0 ;; *) exit 1 ;; esac ;;
esac
exit 0
`
const LOGIN_SHELL_STUB = `#!/bin/sh
printf 'login-shell %s\\n' "$*" >> "$STUB_LOG"
exit 0
`

/** Fresh HOME + stub bin per case, so no test can see another's config file or argv log. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "zed-shell-"))
  const bin = join(root, "bin")
  const home = join(root, "home")
  mkdirSync(bin)
  mkdirSync(home)
  const write = (name, body) => {
    const path = join(bin, name)
    writeFileSync(path, body)
    chmodSync(path, 0o755)
    return path
  }
  write("tmux", TMUX_STUB)
  const shell = write("login-shell", LOGIN_SHELL_STUB)
  return { root, bin, home, shell, log: join(root, "argv.log") }
}

/** Run zed-shell as Zed would, and return every stub invocation it made. */
function runShell(box, env = {}) {
  const result = spawnSync("sh", [ZED_SHELL], {
    encoding: "utf8",
    cwd: box.root,
    env: {
      PATH: `${box.bin}:${process.env.PATH}`,
      HOME: box.home,
      SHELL: box.shell,
      STUB_LOG: box.log,
      ...env,
    },
  })
  const log = existsSync(box.log) ? readFileSync(box.log, "utf8").trim().split("\n").filter(Boolean) : []
  return { ...result, log }
}

function runTerm(box, args, env = {}) {
  return spawnSync("sh", [ZED_TERM, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: box.home, ...env },
  })
}

const configPath = (box) => join(box.home, ".config", "oyren", "zed-terminal")

function writeConfig(box, contents) {
  mkdirSync(dirname(configPath(box)), { recursive: true })
  writeFileSync(configPath(box), contents)
}

// ---------------------------------------------------------------- mode resolution

test("no config and no launch default ⇒ tmux (the built-in default)", () => {
  const box = sandbox()
  const { log } = runShell(box)
  assert.ok(log.some((l) => l.startsWith("tmux -u new-session -d -s zed-1")), log.join("\n"))
  assert.ok(!log.some((l) => l.startsWith("login-shell")), log.join("\n"))
})

test("OYREN_ZED_TERMINAL=tmux (the launch default) ⇒ tmux", () => {
  const box = sandbox()
  const { log } = runShell(box, { OYREN_ZED_TERMINAL: "tmux" })
  assert.ok(log.some((l) => l.startsWith("tmux -u new-session -d -s zed-1")), log.join("\n"))
  assert.ok(!log.some((l) => l.startsWith("login-shell")), log.join("\n"))
})

test("OYREN_ZED_TERMINAL=plain ⇒ a plain login shell", () => {
  const box = sandbox()
  const { log } = runShell(box, { OYREN_ZED_TERMINAL: "plain" })
  assert.deepEqual(log, ["login-shell -l"])
})

test("the in-container choice outranks the launch default (plain over tmux)", () => {
  const box = sandbox()
  writeConfig(box, "plain\n")
  const { log } = runShell(box, { OYREN_ZED_TERMINAL: "tmux" })
  assert.deepEqual(log, ["login-shell -l"])
})

test("the in-container choice outranks the launch default (tmux over plain)", () => {
  const box = sandbox()
  writeConfig(box, "tmux\n")
  const { log } = runShell(box, { OYREN_ZED_TERMINAL: "plain" })
  assert.ok(log.some((l) => l.includes("new-session")), log.join("\n"))
})

test("a comment-and-blank-line config still resolves", () => {
  const box = sandbox()
  writeConfig(box, "# set by zed-term\n\n  tmux  \n")
  const { log } = runShell(box)
  assert.ok(log.some((l) => l.includes("new-session")), log.join("\n"))
})

test("an unrecognised mode falls back to plain rather than failing", () => {
  const box = sandbox()
  writeConfig(box, "screen\n")
  const { log, status } = runShell(box)
  assert.equal(status, 0)
  assert.deepEqual(log, ["login-shell -l"])
})

// ---------------------------------------------------------------- mouse is always off

test("tmux mode sets mouse off on a NEW session, before anything attaches", () => {
  const box = sandbox()
  const { log } = runShell(box, { OYREN_ZED_TERMINAL: "tmux" })
  const created = log.findIndex((l) => l.includes("new-session"))
  const mouseOff = log.findIndex((l) => l === "tmux set-option -t zed-1 mouse off")
  const attached = log.findIndex((l) => l.includes("attach-session"))
  assert.ok(created >= 0 && mouseOff >= 0 && attached >= 0, log.join("\n"))
  assert.ok(created < mouseOff && mouseOff < attached, `expected create → mouse off → attach, got:\n${log.join("\n")}`)
})

test("tmux mode sets mouse off on a RECLAIMED session too (it may predate this script)", () => {
  const box = sandbox()
  const { log } = runShell(box, { OYREN_ZED_TERMINAL: "tmux", STUB_SESSIONS: "zed-4 0" })
  assert.ok(!log.some((l) => l.includes("new-session")), log.join("\n"))
  assert.ok(log.includes("tmux set-option -t zed-4 mouse off"), log.join("\n"))
  assert.ok(log.some((l) => l.endsWith("attach-session -t zed-4")), log.join("\n"))
})

// ---------------------------------------------------------------- session selection

test("reclaims the first UNATTACHED zed session instead of opening another", () => {
  const box = sandbox()
  const { log } = runShell(box, {
    OYREN_ZED_TERMINAL: "tmux",
    STUB_SESSIONS: "main 1\nzed-1 1\nzed-2 0\nzed-3 0",
  })
  assert.ok(log.some((l) => l.endsWith("attach-session -t zed-2")), log.join("\n"))
})

test("ignores non-zed sessions when reclaiming (the web terminal's `main` is not ours)", () => {
  const box = sandbox()
  const { log } = runShell(box, { OYREN_ZED_TERMINAL: "tmux", STUB_SESSIONS: "main 0\nagent-claude-code 0" })
  assert.ok(log.some((l) => l.includes("new-session -d -s zed-1")), log.join("\n"))
})

test("every zed session attached ⇒ opens the next free number", () => {
  const box = sandbox()
  const { log } = runShell(box, {
    OYREN_ZED_TERMINAL: "tmux",
    STUB_SESSIONS: "zed-1 1\nzed-2 1",
    STUB_EXISTING: "zed-1 zed-2",
  })
  assert.ok(log.some((l) => l.includes("new-session -d -s zed-3")), log.join("\n"))
})

test("tmux missing ⇒ a plain shell with a warning, never a dead terminal panel", () => {
  const box = sandbox()
  // A PATH with the text tools zed-shell needs but no tmux.
  const bare = join(box.root, "bare")
  mkdirSync(bare)
  for (const tool of ["sed", "grep", "awk"]) {
    const real = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim()
    if (real) symlinkSync(real, join(bare, tool))
  }
  symlinkSync(box.shell, join(bare, "login-shell"))
  // /bin/sh by absolute path: PATH here deliberately holds nothing but those tools.
  const r = spawnSync("/bin/sh", [ZED_SHELL], {
    encoding: "utf8",
    env: { PATH: bare, HOME: box.home, SHELL: join(bare, "login-shell"), STUB_LOG: box.log, OYREN_ZED_TERMINAL: "tmux" },
  })
  assert.equal(r.status, 0)
  assert.match(r.stderr, /tmux not found/)
  assert.deepEqual(readFileSync(box.log, "utf8").trim().split("\n"), ["login-shell -l"])
})

// ---------------------------------------------------------------- zed-term

test("zed-term writes the choice zed-shell then reads", () => {
  const box = sandbox()
  assert.equal(runTerm(box, ["tmux"]).status, 0)
  assert.match(readFileSync(configPath(box), "utf8"), /^tmux$/m)
  assert.ok(runShell(box).log.some((l) => l.includes("new-session")))
})

test("zed-term default drops the choice and follows the launch default again", () => {
  const box = sandbox()
  runTerm(box, ["plain"])
  const out = runTerm(box, ["default"], { OYREN_ZED_TERMINAL: "tmux" })
  assert.equal(existsSync(configPath(box)), false)
  assert.match(out.stdout, /tmux/)
  assert.ok(runShell(box, { OYREN_ZED_TERMINAL: "tmux" }).log.some((l) => l.includes("new-session")))
})

test("zed-term status names where the mode came from", () => {
  const box = sandbox()
  assert.match(runTerm(box, []).stdout, /tmux {3}\(built-in default/)
  assert.match(runTerm(box, [], { OYREN_ZED_TERMINAL: "tmux" }).stdout, /launch default/)
  runTerm(box, ["plain"])
  assert.match(runTerm(box, [], { OYREN_ZED_TERMINAL: "tmux" }).stdout, /zed-terminal/)
})

test("zed-term rejects an unknown mode instead of writing it", () => {
  const box = sandbox()
  const r = runTerm(box, ["screen"])
  assert.equal(r.status, 64)
  assert.equal(existsSync(configPath(box)), false)
})
