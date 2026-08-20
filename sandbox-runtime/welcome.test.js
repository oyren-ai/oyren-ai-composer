const { test } = require("node:test")
const assert = require("node:assert")
const path = require("path")
const fs = require("fs")
const os = require("os")
const { spawnSync } = require("child_process")

const BANNER = path.join(__dirname, "welcome.sh")

// The banner only prints a CLI it can FIND on PATH (each image ships a different set), so a test that
// ran with the real PATH would assert whatever this machine happens to have installed. Give it a
// throwaway PATH of empty executables instead: that is the only way to pin down which lines appear.
function withStubs(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-welcome-"))
  for (const name of names) {
    fs.writeFileSync(path.join(dir, name), "#!/bin/sh\n", { mode: 0o755 })
  }
  // The banner's heredocs need `cat`, and it is the ONLY external command it runs. Linking it in
  // keeps PATH down to this directory — the machine running the test may well have real agent CLIs
  // in /bin (an Oyren sandbox does), and those would make the assertions about this box, not the script.
  fs.symlinkSync("/bin/cat", path.join(dir, "cat"))
  return dir
}

function run(names, env = {}) {
  const bin = withStubs(names)
  // PATH is ONLY the stub dir (see withStubs), and OYREN_AGENT_PATH replaces the baked-in pnpm/app
  // bins, so the banner can see exactly the CLIs this test asked for and nothing else.
  // Absolute /bin/bash: PATH holds only the stub dir, so "bash" itself would not resolve.
  const r = spawnSync("/bin/bash", [BANNER], {
    env: { PATH: bin, OYREN_AGENT_PATH: bin, HOME: os.tmpdir(), ...env },
    encoding: "utf8",
  })
  fs.rmSync(bin, { recursive: true, force: true })
  return { out: r.stdout, code: r.status }
}

test("lists an agent CLI only when it is actually installed in this image", () => {
  const { out } = run(["claude"])
  assert.match(out, /claude\s+Claude Code/)
  assert.doesNotMatch(out, /Qwen Code/)
})

// cursor-agent is baked by install-agents.sh but went unlisted for months — the banner is the only
// place a user learns which agents a session already has, so a missing line means a missing feature.
test("lists the Cursor CLI under the name that actually runs it", () => {
  const { out } = run(["cursor-agent"])
  assert.match(out, /cursor-agent\s+Cursor CLI/)
})

test("names line up in one column even for the longest CLI name", () => {
  const { out } = run(["claude", "cursor-agent", "dsh"])
  // `cursor-agent` is four characters longer than anything that came before it, so the padding width
  // is a real regression risk: get it wrong and every description shifts on images that ship Cursor.
  const agents = new Set(["claude", "cursor-agent", "dsh"])
  const columns = out
    .split("\n")
    .map((line) => /^ {4}(\S+)( +)\S/.exec(line))
    .filter((m) => m && agents.has(m[1])) // the deploy block is indented the same way — skip it
    .map(([, name, gap]) => 4 + name.length + gap.length)
  assert.equal(columns.length, 3, "expected three agent lines")
  assert.equal(new Set(columns).size, 1, `descriptions start at different columns: ${columns}`)
})

test("prints no assistants block at all on an image that ships none", () => {
  const { out } = run([])
  assert.doesNotMatch(out, /AI coding assistant/)
  assert.match(out, /Oyren cloud sandbox/)
})

// The terminal a user lands in IS a tmux session, which they only discover when a keystroke goes
// somewhere unexpected. The way out has to be in the banner or it is nowhere.
test("says how to leave tmux — the detach key and the Zed opt-out", () => {
  const { out } = run([])
  assert.match(out, /Ctrl-b/)
  assert.match(out, /zed-term plain/)
})

test("still tells the user how to reach their app from the outside", () => {
  const { out } = run([])
  assert.match(out, /oyren expose <port>/)
  assert.match(out, /oyren-help/)
})

test("exits cleanly even with no repo and no agent (a bare `oyren-help`)", () => {
  const { code } = run([])
  assert.equal(code, 0)
})
