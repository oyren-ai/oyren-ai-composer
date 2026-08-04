const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path")
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-engine-")) // isolate the session-id file
process.env.WORKING_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-engine-wd-")) // repo-less → no recovery preamble
const { test } = require("node:test")
const assert = require("node:assert")
const engine = require("./agentEngine")
const broadcast = require("./agentBroadcast")
const recovery = require("./agentRecovery")
const { makeFakeSdk } = require("./agentFakes")

const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)) }

test("send lazily starts ONE session with the right options, pushes the user turn, and marks busy", async () => {
  broadcast.reset()
  const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  await engine.send([{ type: "text", text: "hi" }])
  await engine.send("again") // second send must NOT start a second session
  await tick()
  assert.equal(sdk.calls.starts, 1)
  assert.equal(sdk.calls.options.permissionMode, "bypassPermissions") // never hang on a permission gate
  assert.equal(sdk.calls.options.includePartialMessages, true)
  assert.equal(engine.state().busy, true)
  assert.equal(sdk.inputs.length, 2)
  assert.deepEqual(sdk.inputs[0].message.content, [{ type: "text", text: "hi" }])
  assert.match(sdk.inputs[1].message.content[0].text, /The previous agent turn in this same chat is still in progress/)
  assert.match(sdk.inputs[1].message.content[0].text, /again/)
})

test("a result message clears busy and every SDK message is recorded to the broadcast", async () => {
  broadcast.reset()
  const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  await engine.send("go")
  sdk.emit({ type: "assistant", session_id: "s1", message: { content: [{ type: "text", text: "yo" }] } })
  sdk.emit({ type: "result", subtype: "success", session_id: "s1" })
  await tick()
  assert.equal(engine.state().busy, false)
  const dump = broadcast.snapshot().join("\n")
  assert.match(dump, /"text":"yo"/)
  assert.match(dump, /"result"/)
})

test("a result message triggers an immediate best-effort agent-meta report (closes the recovery blind window)", async () => {
  broadcast.reset()
  const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  const metaReport = require("./agentMetaReport")
  const original = metaReport.reportMeta
  let calls = 0
  metaReport.reportMeta = async () => { calls++; return "sent" }
  try {
    await engine.send("go")
    assert.equal(calls, 0) // not on send — only once the turn actually finishes
    sdk.emit({ type: "result", subtype: "success", session_id: "s1" })
    await tick()
    assert.equal(calls, 1)
  } finally {
    metaReport.reportMeta = original
  }
})

test("an id-tagged send exposes turnId/done on state and replays by id (loop compat)", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  await engine.send("go", "t9")
  assert.deepEqual(engine.state().turnId, "t9")
  assert.equal(engine.state().done, false)
  sdk.emit({ type: "assistant", session_id: "s1", message: { content: [{ type: "text", text: "hi" }] } })
  sdk.emit({ type: "result", subtype: "success", session_id: "s1" })
  await tick()
  assert.equal(engine.state().done, true)
  assert.match((engine.replayTurn("t9") || []).join("\n"), /"text":"hi"/)
  assert.equal(engine.replayTurn("other"), null)
})

const agentMeta = require("./agentMeta")
const withStoredMeta = (meta) => {
  recovery.__reset(); agentMeta.__reset()
  process.env.AGENT_META_B64 = Buffer.from(JSON.stringify(meta)).toString("base64")
  return () => { delete process.env.AGENT_META_B64; agentMeta.__reset() }
}

test("recovery preamble fires on a blank boot with stored meta — and only on the FIRST send", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  const cleanup = withStoredMeta({ turnCount: 2, repos: [{ dir: "app", branch: "feat/y" }] })
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-engine-h2-")) // no session file → blank boot
  await engine.send("continue the task")
  await tick()
  assert.match(sdk.inputs[0].message.content[0].text, /^\[CONTEXT RECOVERY\]/)
  assert.match(sdk.inputs[0].message.content[0].text, /your working branch is `feat\/y`/)
  assert.match(sdk.inputs[0].message.content[0].text, /continue the task/)
  await engine.send("still there?") // same boot: recovered context is already in-session
  await tick()
  assert.ok(!sdk.inputs[1].message.content[0].text.includes("[CONTEXT RECOVERY]"))
  cleanup()
})

test("without stored meta a brand-new session never sees the preamble", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  recovery.__reset(); agentMeta.__reset()
  delete process.env.AGENT_META_B64
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-engine-h3-")) // blank boot, but nothing to recover
  await engine.send("first task ever")
  await tick()
  assert.equal(sdk.inputs[0].message.content[0].text, "first task ever")
})

test("a persisted session id (node-only restart) suppresses the preamble — --resume carries context", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  const cleanup = withStoredMeta({ turnCount: 7, repos: [] }) // meta present — the resume must suppress it
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-engine-h4-"))
  require("./agentSession").writeSessionId("prior-session")
  await engine.send("resume work")
  await tick()
  assert.equal(sdk.inputs[0].message.content[0].text, "resume work")
  cleanup()
})

test("interrupt calls the SDK and clears busy; setModel + listModels drive the model", async () => {
  broadcast.reset()
  const sdk = makeFakeSdk({ models: [{ value: "opus", displayName: "Opus" }, { value: "sonnet", displayName: "Sonnet" }] })
  engine.__setQueryImpl(sdk.query)
  await engine.send("work")
  await engine.interrupt()
  assert.equal(sdk.calls.interrupt, 1)
  assert.equal(engine.state().busy, false)
  await engine.setModel("sonnet")
  assert.deepEqual(sdk.calls.setModel, ["sonnet"])
  const { models, current } = await engine.listModels()
  assert.equal(models.length, 2)
  assert.equal(current, "sonnet")
})
