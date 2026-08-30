// The oyren-tmux unit's start path. This file exists because the unit shipped DEAD: its launcher
// ran `tmux -u -D start-server`, and every tmux with -D refuses a trailing command
// (`if ((flags & CLIENT_NOFORK) && argc != 0) usage();` in tmux.c): so the unit usage-looped on
// every droplet since 2026-08-26 and nothing here ever executed the argv to notice. These tests run
// the REAL invocation against a real tmux on a private socket, and pin the old argv as the failure
// it always was.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const LAUNCHER = join(HERE, "start-tmux.mjs")
const UNIT = readFileSync(join(HERE, "../units/oyren-tmux.service"), "utf8")
const WRAPPER = readFileSync(join(HERE, "run-tmux-server.sh"), "utf8")

const haveTmux = spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- the unit file's contract
test("ExecStart execs tmux -u -D with NO trailing command: the trailing command is what usage-looped every droplet", () => {
  const execStart = UNIT.split("\n").find((l) => l.startsWith("ExecStart="))
  assert.equal(execStart, "ExecStart=/usr/local/lib/oyren/run-tmux-server.sh")
  const code = WRAPPER.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"))
  assert.equal(code.at(-1), "exec /usr/bin/tmux -u -D", "the wrapper must end by BECOMING the server")
  assert.ok(!UNIT.includes("start-server"), "no tmux subcommand may ride along with -D")
})

test("the tmux server is shielded from the OOM killer: panes are the last thing the kernel should take", () => {
  assert.match(UNIT, /^OOMScoreAdjust=-500$/m)
})

test("the unit still carries its session env, user and restart policy", () => {
  for (const line of [
    "EnvironmentFile=/etc/oyren/host.env",
    "EnvironmentFile=/etc/oyren/sandbox.env",
    "User=oyren",
    "Restart=on-failure",
    "ConditionPathExists=/etc/oyren/sandbox.env",
  ]) assert.ok(UNIT.includes(line), `unit keeps: ${line}`)
})

// ---------------------------------------------------------------- --export-env
const exportEnv = (extraEnv) =>
  spawnSync("node", [LAUNCHER, "--export-env"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extraEnv },
  })

test("--export-env round-trips a multi-line, quote-laden session value byte-exact through bash eval", () => {
  const hairy = "line1\nline2 with 'single' \"double\" $dollar `tick` \\backslash"
  const b64 = Buffer.from(JSON.stringify({ LAUNCH_TASK: hairy, PLAIN: "ok" })).toString("base64")
  const out = exportEnv({ CONTAINER_ENV_B64: b64 })
  assert.equal(out.status, 0, out.stderr)
  const echoed = spawnSync("bash", ["-s"], {
    encoding: "utf8",
    input: `${out.stdout}\nprintf '%s' "$LAUNCH_TASK"`,
    env: { PATH: process.env.PATH },
  })
  assert.equal(echoed.status, 0, echoed.stderr)
  assert.equal(echoed.stdout, hairy)
  assert.match(out.stdout, /^export PLAIN='ok'$/m)
})

test("--export-env applies the Node heap default and never re-exports the blob itself", () => {
  const b64 = Buffer.from(JSON.stringify({ A: "1" })).toString("base64")
  const out = exportEnv({ CONTAINER_ENV_B64: b64 })
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /^export NODE_OPTIONS='--max-old-space-size=4096'$/m)
  assert.ok(!out.stdout.includes("CONTAINER_ENV_B64"), "the decoded blob must not be re-exported")
})

test("--export-env skips names bash cannot export instead of emitting a line that would abort the eval", () => {
  const b64 = Buffer.from(JSON.stringify({ "BAD-NAME": "x", GOOD_NAME: "y" })).toString("base64")
  const out = exportEnv({ CONTAINER_ENV_B64: b64 })
  assert.equal(out.status, 0, out.stderr)
  assert.ok(!out.stdout.includes("BAD-NAME"))
  assert.match(out.stdout, /^export GOOD_NAME='y'$/m)
})

test("--export-env with no session blob still succeeds: first boots have host.env only", () => {
  const out = exportEnv({})
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /^export NODE_OPTIONS=/m)
})

// ---------------------------------------------------------------- the real invocation
test("tmux -u -D runs as a foreground server that accepts clients", { skip: !haveTmux }, async () => {
  const sock = `oyren-start-${process.pid}`
  const server = spawn("tmux", ["-L", sock, "-u", "-D"], { stdio: "ignore" })
  try {
    await sleep(700)
    assert.equal(server.exitCode, null, "the -D server must still be running")
    const probe = spawnSync("tmux", ["-L", sock, "show", "-g", "status"], { encoding: "utf8" })
    assert.equal(probe.status, 0, `a client must reach the server: ${probe.stderr}`)
  } finally {
    spawnSync("tmux", ["-L", sock, "kill-server"], { encoding: "utf8" })
  }
  await sleep(300)
  assert.notEqual(server.exitCode, null, "kill-server ends the foreground process")
})

test("the OLD argv: tmux -u -D start-server: fails with usage, pinning the bug that shipped", { skip: !haveTmux }, () => {
  const out = spawnSync("tmux", ["-L", `oyren-old-${process.pid}`, "-u", "-D", "start-server"], { encoding: "utf8" })
  assert.notEqual(out.status, 0)
  assert.match(out.stderr, /usage: tmux/)
})
