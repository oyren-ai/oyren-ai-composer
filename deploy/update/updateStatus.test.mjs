import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { nextStatus, readStatus, report, reportBody, runCli, sessionEnvFrom, writeStatus } from "./updateStatus.mjs"

const tmp = () => join(mkdtempSync(join(tmpdir(), "update-status-")), "update-status.json")

test("a run stamps startedAt once, steps merge in, done/failed stamp finishedAt", () => {
  const t0 = "2026-08-26T10:00:00.000Z", t1 = "2026-08-26T10:01:00.000Z", t2 = "2026-08-26T10:03:00.000Z"
  let s = nextStatus(null, { state: "running", step: "starting", from: "2026-08-20-1410", to: "2026-08-25-1838", unit: "oyren-update-1" }, t0)
  assert.equal(s.startedAt, t0)
  s = nextStatus(s, { step: "applying:claude", changed: "claude,runtime" }, t1)
  assert.equal(s.startedAt, t0, "a step does not restart the clock")
  assert.deepEqual(s.changed, ["claude", "runtime"])
  assert.equal(s.state, "running")
  s = nextStatus(s, { state: "done", step: "done", applied: "claude,runtime" }, t2)
  assert.equal(s.finishedAt, t2)
  assert.equal(s.error, null)
  const failed = nextStatus(s, { state: "running", step: "starting" }, t2)
  assert.equal(failed.startedAt, t2, "a new run restarts the clock")
  assert.equal(failed.finishedAt, null)
})

test("writeStatus is atomic and readStatus tolerates a missing file", () => {
  const file = tmp()
  assert.equal(readStatus(file), null)
  writeStatus(file, { state: "running", step: "fetching" })
  assert.equal(readStatus(file).step, "fetching")
  writeStatus(file, { state: "failed", step: "applying:runtime", error: "node-pty did not build" })
  const s = readStatus(file)
  assert.equal(s.state, "failed")
  assert.equal(s.error, "node-pty did not build")
  assert.ok(s.finishedAt)
})

test("the report body is what /sandbox/update-result expects, and needs the session env", () => {
  const status = { state: "done", step: "done", from: "a", to: "b", error: null }
  assert.equal(reportBody(status, {}), null)
  const r = reportBody(status, { ORCHESTRATOR_URL: "https://api.example/", OYREN_SESSION_SLUG: "sb-1", CONTROL_TOKEN: "ct" })
  assert.equal(r.url, "https://api.example/sandbox/update-result")
  assert.deepEqual(r.body, { appSlug: "sb-1", controlToken: "ct", state: "done", step: "done", from: "a", to: "b", error: null })
})

test("sessionEnvFrom decodes CONTAINER_ENV_B64 out of sandbox.env", () => {
  const b64 = Buffer.from(JSON.stringify({ ORCHESTRATOR_URL: "https://api.example", OYREN_SESSION_SLUG: "sb-1", CONTROL_TOKEN: "ct" })).toString("base64")
  assert.equal(sessionEnvFrom(`SANDBOX_IMAGE=x\nCONTAINER_PORT=8080\nCONTAINER_ENV_B64=${b64}\n`).OYREN_SESSION_SLUG, "sb-1")
  assert.deepEqual(sessionEnvFrom("SANDBOX_IMAGE=x\n"), {})
  assert.deepEqual(sessionEnvFrom("CONTAINER_ENV_B64=!!!\n"), {})
})

test("report posts and is best-effort: a failing orchestrator never throws", async () => {
  const calls = []
  const ok = await report({ state: "running", step: "fetching" }, { ORCHESTRATOR_URL: "https://api.example", OYREN_SESSION_SLUG: "sb-1", CONTROL_TOKEN: "ct" }, async (url, init) => { calls.push({ url, init }); return { ok: true } })
  assert.equal(ok, true)
  assert.equal(calls[0].url, "https://api.example/sandbox/update-result")
  assert.equal(JSON.parse(calls[0].init.body).step, "fetching")
  assert.equal(await report({ state: "done" }, { ORCHESTRATOR_URL: "https://api.example", OYREN_SESSION_SLUG: "sb-1", CONTROL_TOKEN: "ct" }, async () => { throw new Error("down") }), false)
})

test("the CLI writes, reads and reports from a sandbox.env file", async () => {
  const file = tmp()
  let out = ""
  const stdout = (s) => { out += s }
  assert.equal(await runCli(["write", "--file", file, "--state", "running", "--step", "starting", "--from", "a", "--to", "b"], { stdout }), 0)
  assert.equal(await runCli(["read", "--file", file], { stdout }), 0)
  assert.equal(JSON.parse(readFileSync(file, "utf8")).to, "b")
  const sandboxEnv = join(mkdtempSync(join(tmpdir(), "sandbox-env-")), "sandbox.env")
  const b64 = Buffer.from(JSON.stringify({ ORCHESTRATOR_URL: "https://api.example", OYREN_SESSION_SLUG: "sb-1", CONTROL_TOKEN: "ct" })).toString("base64")
  writeFileSync(sandboxEnv, `CONTAINER_ENV_B64=${b64}\n`)
  const posted = []
  assert.equal(await runCli(["report", "--file", file, "--sandbox-env", sandboxEnv], { stdout, fetchImpl: async (url, init) => { posted.push(JSON.parse(init.body)); return { ok: true } } }), 0)
  assert.equal(posted[0].appSlug, "sb-1")
  assert.equal(posted[0].from, "a")
  assert.equal(await runCli(["read", "--file", join(tmpdir(), "nope.json")], { stdout }), 1)
})
