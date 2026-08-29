const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { updateCommand, parseArgs } = require("./update")

const ENV = { ORCHESTRATOR_URL: "https://api.example", OYREN_SESSION_SLUG: "sb-1", CONTROL_TOKEN: "ct" }
const release = { version: "2026-08-25-1838", family: "base", manifestUrl: "https://m?sig", tarballUrl: "https://t?sig" }
const fetchImpl = async () => ({ status: 200, ok: true, json: async () => release })

function harness(execScript, statuses) {
  const calls = []
  let out = ""
  let n = 0
  const deps = {
    env: ENV, fetchImpl, stdout: (s) => { out += s }, sleep: async () => {},
    exec: async (cmd, args) => { calls.push([cmd, ...args]); return execScript(cmd, args) },
    readStatus: () => statuses[Math.min(n++, statuses.length - 1)],
  }
  return { calls, deps, output: () => out }
}

test("parseArgs knows the flags and rejects the rest", () => {
  assert.deepEqual(parseArgs(["--check", "--json"]).check, true)
  assert.deepEqual(parseArgs(["--force", "claude", "--force", "dsh", "--no-wait", "--yes"]), { check: false, status: false, wait: false, json: false, force: ["claude", "dsh"], manifestUrl: "", tarballUrl: "" })
  assert.throws(() => parseArgs(["--frobnicate"]), /unknown option/)
})

test("--check resolves the release and hands the manifest URL to the updater", async () => {
  const h = harness(async () => ({ code: 3, stdout: "claude 2.1.191 → 2.1.235\n", stderr: "" }), [])
  assert.equal(await updateCommand(["--check"], h.deps), 3)
  assert.deepEqual(h.calls[0], ["/usr/local/bin/oyren-update", "--check", "--manifest-url", "https://m?sig"])
  assert.equal(h.output(), "claude 2.1.191 → 2.1.235\n")
})

test("an up-to-date machine applies nothing", async () => {
  const h = harness(async () => ({ code: 0, stdout: "[]", stderr: "" }), [])
  assert.equal(await updateCommand([], h.deps), 0)
  assert.equal(h.calls.length, 1, "only the check ran")
  assert.equal(h.output(), "up to date\n")
})

test("apply prints the diff, starts the root updater with sudo, and follows the status to done", async () => {
  const exec = async (cmd, args) => {
    if (args.includes("--check")) return { code: 3, stdout: JSON.stringify([{ component: "claude", from: "2.1.191", to: "2.1.235" }]), stderr: "" }
    return { code: 0, stdout: '{"unit":"oyren-update-1"}\n', stderr: "" }
  }
  const h = harness(exec, [{ state: "running", step: "fetching" }, { state: "running", step: "applying:claude" }, { state: "done", step: "done", to: "2026-08-25-1838", applied: ["claude"] }])
  assert.equal(await updateCommand([], h.deps), 0)
  assert.deepEqual(h.calls[1].slice(0, 3), ["sudo", "-n", "/usr/local/bin/oyren-update"])
  assert.ok(h.calls[1].includes("--expect-version") && h.calls[1].includes("2026-08-25-1838"))
  assert.match(h.output(), /applying 2026-08-25-1838:\nclaude 2\.1\.191 → 2\.1\.235/)
  assert.match(h.output(), /Updated to 2026-08-25-1838 \(claude\)\./)
})

test("a failed run ends with the reason and a next step; --no-wait returns right after the start", async () => {
  const exec = async (cmd, args) => args.includes("--check") ? { code: 3, stdout: "[]", stderr: "" } : { code: 0, stdout: '{"unit":"u"}\n', stderr: "" }
  const failed = harness(exec, [{ state: "failed", step: "applying:runtime", error: "node-pty did not build", log: "/var/log/oyren-update.log" }])
  assert.equal(await updateCommand(["--force", "runtime"], failed.deps), 1)
  assert.match(failed.output(), /failed at applying:runtime: node-pty did not build/)
  assert.match(failed.output(), /resumes from where it stopped/)
  const nowait = harness(exec, [])
  assert.equal(await updateCommand(["--force", "runtime", "--no-wait", "--json"], nowait.deps), 0)
  assert.equal(nowait.output(), '{"unit":"u"}\n')
})

test("--status reports the last run without touching the orchestrator", async () => {
  const h = harness(async () => { throw new Error("must not exec") }, [{ state: "done", to: "b", applied: ["claude"] }])
  assert.equal(await updateCommand(["--status"], { ...h.deps, fetchImpl: async () => { throw new Error("must not fetch") } }), 0)
  assert.equal(h.output(), "updated to b (claude)\n")
})

test("without an orchestrator link the error names the manual flags", async () => {
  const h = harness(async () => ({ code: 0, stdout: "", stderr: "" }), [])
  await assert.rejects(updateCommand(["--check"], { ...h.deps, env: {} }), /--manifest-url/)
})
