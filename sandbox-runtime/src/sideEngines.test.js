process.env.AGENT_KIND = "qwen-code" // the LAUNCH agent — side engines are everything else
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path")
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-side-"))
process.env.WORKING_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-side-wd-"))
const { test } = require("node:test")
const assert = require("node:assert")
const side = require("./sideEngines")
const broadcast = require("./agentBroadcast")
const { makeFakeAcpChild } = require("./acp/acpFakes")

function scriptedAcp({ onPrompt } = {}) {
  return () => makeFakeAcpChild(async (method, params, io) => {
    if (method === "initialize") return { protocolVersion: 1, agentCapabilities: {} }
    if (method === "session/new") return { sessionId: "side1", models: { currentModelId: "m1", availableModels: [{ modelId: "m1", name: "Model One" }] } }
    if (method === "session/prompt") return onPrompt ? onPrompt(params, io) : { stopReason: "end_turn" }
    throw new Error(`unexpected ${method}`)
  })
}

test("isSideKind: ACP kinds other than the launch agent only", () => {
  assert.equal(side.isSideKind("opencode"), true)
  assert.equal(side.isSideKind("qwen-code"), false) // the launch agent is not a SIDE engine
  assert.equal(side.isSideKind("claude-code"), false) // SDK engine, no ACP recipe
  assert.equal(side.isSideKind("made-up"), false)
  assert.equal(side.isSideKind(""), false)
})

test("a side turn streams to ITS sink and never touches the broadcast", async () => {
  broadcast.reset()
  side.__setSpawnImpl(scriptedAcp({
    onPrompt: (params, { notify }) => {
      notify("session/update", { sessionId: "side1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "side says hi" } } })
      return { stopReason: "end_turn" }
    },
  }))
  const lines = []
  await side.send("opencode", [{ type: "text", text: "hello side" }], (l) => lines.push(l))
  assert.match(lines.join("\n"), /"text_delta","text":"side says hi"/)
  const last = JSON.parse(lines[lines.length - 1])
  assert.deepEqual(last, { type: "result", subtype: "success" })
  // The isolation that justifies this module: the pane's feed saw NOTHING of the side turn.
  assert.deepEqual(broadcast.snapshot(), [])
})

test("a busy side engine refuses a second concurrent turn with a result error", async () => {
  let release
  side.__setSpawnImpl(scriptedAcp({ onPrompt: () => new Promise((r) => { release = () => r({ stopReason: "end_turn" }) }) }))
  const first = []
  const firstDone = side.send("opencode", "long turn", (l) => first.push(l))
  await new Promise((r) => setTimeout(r, 50)) // let the first turn reach the prompt await
  const second = []
  await side.send("opencode", "impatient", (l) => second.push(l))
  const refusal = JSON.parse(second[second.length - 1])
  assert.equal(refusal.type, "result")
  assert.equal(refusal.is_error, true)
  assert.match(refusal.error, /already running/)
  release()
  await firstDone
  assert.equal(JSON.parse(first[first.length - 1]).subtype, "success")
})

test("a crashed side turn ends with an is_error result carrying the failure", async () => {
  side.__setSpawnImpl(scriptedAcp({ onPrompt: () => { throw new Error("engine exploded") } }))
  const lines = []
  await side.send("opencode", "boom", (l) => lines.push(l))
  const last = JSON.parse(lines[lines.length - 1])
  assert.equal(last.is_error, true)
  assert.match(last.error, /engine exploded/)
})
