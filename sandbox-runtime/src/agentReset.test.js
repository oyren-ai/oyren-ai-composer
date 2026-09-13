// The conversation-reset primitive, driven through the real handler with the fake SDK: what is
// pinned is the reset CONTRACT — busy ends, the persisted resume id is cleared so the next send
// starts fresh (no --resume), the boundary marker lands on the broadcast WITHOUT wiping the ring,
// and the whole thing is idempotent.
process.env.SESSION_TOKEN = "tok" // config reads this at require-time
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path")
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-reset-"))
process.env.WORKING_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-reset-wd-")) // repo-less → no recovery preamble
// Inside a real container these are set for real, and agentMeta would fetch the LIVE session's
// meta from the LIVE orchestrator — injecting a real recovery preamble into these tests.
for (const k of ["ORCHESTRATOR_URL", "OYREN_SESSION_SLUG", "CONTROL_TOKEN", "AGENT_META_B64", "AGENT_KIND"]) delete process.env[k]
const { test } = require("node:test")
const assert = require("node:assert")
const engine = require("./agentEngine")
const broadcast = require("./agentBroadcast")
const { readSessionId, writeSessionId } = require("./agentSession")
const { handleAgentReset } = require("./agentReset")
const { drive, makeFakeSdk } = require("./agentFakes")

const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)) }

test("POST without the session token is 401; GET with it is 405", async () => {
  assert.equal((await drive(handleAgentReset, { method: "POST", url: "/agent/reset" })).status, 401)
  assert.equal((await drive(handleAgentReset, { method: "GET", url: "/agent/reset?token=tok" })).status, 405)
})

test("reset mid-turn: interrupts, ends busy, clears the resume id, and the next send starts fresh", async () => {
  broadcast.reset()
  const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  writeSessionId("prior-session")
  await engine.send("long task")
  await tick()
  assert.equal(engine.state().busy, true)
  assert.equal(sdk.calls.options.resume, "prior-session") // the pre-reset session resumed as usual

  const res = await drive(handleAgentReset, { method: "POST", url: "/agent/reset?token=tok" })
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(res.body()).ok, true)
  assert.equal(sdk.calls.interrupt, 1) // interrupt-before-teardown ordering
  assert.equal(engine.state().busy, false)
  assert.equal(engine.state().started, false)
  assert.equal(readSessionId(), null) // resume id cleared

  await engine.send("new conversation")
  await tick()
  assert.equal(sdk.calls.starts, 2) // a second, fresh session
  assert.equal(sdk.calls.options.resume, undefined) // …that does NOT resume the old one
})

test("the boundary marker lands on the broadcast and the ring is KEPT, with a fresh index", async () => {
  broadcast.reset()
  const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  await engine.send("hello")
  await tick()
  sdk.emit({ type: "assistant", session_id: "s1", message: { content: [{ type: "text", text: "world" }] } })
  await tick()
  const before = broadcast.snapshot().length
  assert.ok(before > 0, "pre-reset history exists")

  await drive(handleAgentReset, { method: "POST", url: "/agent/reset?token=tok" })
  const lines = broadcast.snapshot().map((l) => JSON.parse(l))
  const marker = lines.find((j) => j.type === "conversation_reset")
  assert.ok(marker, "marker recorded")
  assert.equal(typeof marker.at, "number")
  assert.equal(broadcast.snapshot().length, before + 1, "history before the boundary survives — no ring wipe")
})

test("reset is idempotent and safe when idle", async () => {
  broadcast.reset()
  const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  for (let i = 0; i < 2; i++) {
    const res = await drive(handleAgentReset, { method: "POST", url: "/agent/reset?token=tok" })
    assert.equal(res.status, 200, `reset #${i + 1}`)
  }
  assert.equal(broadcast.snapshot().filter((l) => l.includes("conversation_reset")).length, 2)
})

test("a stale pump draining its tail after reset cannot re-persist the cleared session id", async () => {
  broadcast.reset()
  const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  await engine.send("task")
  await tick()
  await drive(handleAgentReset, { method: "POST", url: "/agent/reset?token=tok" })
  assert.equal(readSessionId(), null)
  // The OLD session's generator coughs up a trailing message carrying the old id.
  sdk.emit({ type: "assistant", session_id: "old-session", message: { content: [] } })
  await tick()
  assert.equal(readSessionId(), null, "stale pump must not resurrect the resume id")
})
