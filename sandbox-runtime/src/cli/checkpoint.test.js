const { test } = require("node:test")
const assert = require("node:assert/strict")
const { boundedCheckpoint, checkpointCommand } = require("./checkpoint")

const collect = () => { const lines = []; return { lines, stdout: (s) => lines.push(s) } }

test("prints one line per repo and exits 0 when nothing failed", async () => {
  const { lines, stdout } = collect()
  const run = async () => [{ dir: "/w/repo", outcome: "pushed abc123" }, { dir: "/w/two", outcome: "clean" }]
  assert.equal(await checkpointCommand([], { stdout, run, env: {} }), 0)
  assert.deepEqual(lines, ["repo: pushed abc123\n", "two: clean\n"])
})

test("a *-failed outcome makes the exit code say so; --json carries the same rows", async () => {
  const { lines, stdout } = collect()
  const run = async () => [{ dir: "/w/repo", outcome: "push-failed" }]
  assert.equal(await checkpointCommand(["--json"], { stdout, run, env: {} }), 1)
  assert.deepEqual(JSON.parse(lines[0]), { results: [{ repo: "repo", outcome: "push-failed" }], timedOut: false })
})

test("a hung pass is bounded by --timeout and reported, never awaited forever", async () => {
  const { lines, stdout } = collect()
  const run = () => new Promise(() => {})
  assert.equal(await checkpointCommand(["--timeout", "0"], { stdout, run, env: {} }), 1)
  assert.match(lines.join(""), /timed out/)
})

test("the disable flag skips the pass entirely", async () => {
  let ran = false
  const out = await boundedCheckpoint({ env: { OYREN_CHECKPOINT_DISABLED: "1" }, run: async () => { ran = true; return [] } })
  assert.deepEqual(out, { results: [], timedOut: false })
  assert.equal(ran, false)
})
