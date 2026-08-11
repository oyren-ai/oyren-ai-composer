const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { runCaptured, MAX_OUTPUT } = require("./runScript")

test("captures stdout and a zero exit code", async () => {
  const r = await runCaptured("echo hello")
  assert.equal(r.exitCode, 0)
  assert.equal(r.timedOut, false)
  assert.match(r.stdout, /hello/)
})

test("runs a workspace shell file through bash", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oyren-script-"))
  try {
    await fs.writeFile(path.join(dir, "verify.sh"), "echo shell-file-ok\n")
    const r = await runCaptured("bash ./verify.sh", { cwd: dir, logger: { info() {} } })
    assert.equal(r.exitCode, 0)
    assert.equal(r.stdout, "shell-file-ok\n")
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("captures stderr and a non-zero exit code", async () => {
  const r = await runCaptured("echo oops 1>&2; exit 3")
  assert.equal(r.exitCode, 3)
  assert.match(r.stderr, /oops/)
})

test("runs in the given cwd", async () => {
  const r = await runCaptured("pwd", { cwd: "/tmp" })
  assert.match(r.stdout, /\/tmp/)
})

test("times out and kills a long-running command", async () => {
  const r = await runCaptured("sleep 5", { timeoutMs: 100 })
  assert.equal(r.timedOut, true)
  assert.notEqual(r.exitCode, 0)
})

test("caps very large output at MAX_OUTPUT", async () => {
  // yes | head prints a lot fast; the cap keeps the buffer bounded.
  const r = await runCaptured("for i in $(seq 1 200000); do echo 0123456789; done")
  assert.ok(r.stdout.length <= MAX_OUTPUT)
})

test("resolves with exitCode null when spawn itself fails", async () => {
  const badSpawn = () => { throw new Error("spawn boom") }
  const r = await runCaptured("echo hi", { spawnFn: badSpawn })
  assert.equal(r.exitCode, null)
  assert.match(r.stderr, /boom/)
})
