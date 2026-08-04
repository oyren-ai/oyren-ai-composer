process.env.AGENT_KIND = "qwen-code" // an ACP kind so spawnConfigFor resolves (engine reads it per call)
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path")
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-acp-")) // isolate the persisted session-id file
process.env.WORKING_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-acp-wd-")) // repo-less → no recovery preamble
const { test } = require("node:test")
const assert = require("node:assert")
const engine = require("./acpEngine")
const broadcast = require("./agentBroadcast")
const recovery = require("./agentRecovery")
const { makeFakeAcpChild, until } = require("./acp/acpFakes")

const dump = () => broadcast.snapshot().join("\n")

// A scripted ACP agent: initialize/session/new answered canonically; session/prompt is per-test.
function scriptedAcp({ onPrompt, onNew } = {}) {
  const children = []
  const spawn = () => {
    const child = makeFakeAcpChild(async (method, params, io) => {
      if (method === "initialize") return { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } } }
      if (method === "session/new") return onNew ? onNew(params) : { sessionId: "s1", models: { currentModelId: "m1", availableModels: [{ modelId: "m1", name: "Model One" }] } }
      if (method === "session/prompt") return onPrompt ? onPrompt(params, io) : { stopReason: "end_turn" }
      throw new Error(`unexpected ${method}`)
    })
    children.push(child)
    return child
  }
  return { spawn, children }
}

test("a full turn: init line, streamed text, tool call/result, consolidated assistant, result success", async () => {
  broadcast.reset()
  process.env.OYREN_MCP_SERVERS = JSON.stringify([{ name: "workspace files", url: "https://mcp.oyren.ai/x", token: "tk" }])
  const prompts = []
  const fake = scriptedAcp({
    onPrompt: (params, { notify }) => {
      prompts.push(params.prompt)
      if (prompts.length > 1) return { stopReason: "end_turn" } // the second send just completes
      notify("session/update", { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hel" } } })
      notify("session/update", { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } } })
      notify("session/update", { sessionId: "s1", update: { sessionUpdate: "tool_call", toolCallId: "tc1", title: "Read", rawInput: { p: 1 } } })
      notify("session/update", { sessionId: "s1", update: { sessionUpdate: "tool_call_update", toolCallId: "tc1", status: "completed", rawOutput: "done" } })
      return { stopReason: "end_turn" }
    },
  })
  engine.__setSpawnImpl(fake.spawn)
  await engine.send([{ type: "text", text: "hi" }])
  assert.equal(engine.state().busy, true)
  await until(() => /"type":"result"/.test(dump()))
  assert.deepEqual(prompts[0], [{ type: "text", text: "hi" }]) // payload reached the agent as ACP blocks
  const lines = broadcast.snapshot().map((l) => JSON.parse(l))
  assert.deepEqual(lines[0], { type: "system", subtype: "init", session_id: "s1", model: "m1", tools: [] })
  assert.match(dump(), /"text_delta","text":"hel"/)
  assert.match(dump(), /"tool_use","id":"tc1"/)
  assert.match(dump(), /"tool_result","tool_use_id":"tc1","content":"done"/)
  assert.ok(lines.some((l) => l.type === "assistant" && JSON.stringify(l.message.content).includes('"hello"'))) // consolidated text
  assert.deepEqual(lines[lines.length - 1], { type: "result", subtype: "success" })
  assert.equal(engine.state().busy, false)
  // session/new carried the cwd + the oyren MCP servers (agent advertised http mcp capability)
  const newReq = fake.children[0].received.find((m) => m.method === "session/new")
  assert.equal(newReq.params.mcpServers[0].url, "https://mcp.oyren.ai/x")
  assert.equal(newReq.params.mcpServers[0].headers[0].value, "Bearer tk")
  // a second send reuses the SAME child/session — no respawn while healthy
  await engine.send("again")
  await until(() => fake.children[0].received.filter((m) => m.method === "session/prompt").length === 2)
  assert.equal(fake.children.length, 1)
  delete process.env.OYREN_MCP_SERVERS
})

test("a follow-up send while busy carries a continuity reminder", async () => {
  broadcast.reset()
  let promptCount = 0
  const fake = scriptedAcp({
    onPrompt: () => {
      promptCount++
      return promptCount === 1 ? new Promise(() => {}) : { stopReason: "end_turn" }
    },
  })
  engine.__setSpawnImpl(fake.spawn)
  await engine.send("long task")
  await until(() => fake.children[0].received.some((m) => m.method === "session/prompt"))
  await engine.send("how is it going?")
  await until(() => fake.children[0].received.filter((m) => m.method === "session/prompt").length === 2)
  const second = fake.children[0].received.filter((m) => m.method === "session/prompt")[1]
  assert.match(second.params.prompt[0].text, /The previous agent turn in this same chat is still in progress/)
  assert.match(second.params.prompt[0].text, /how is it going\?/)
})

test("models come from the session; interrupt sends session/cancel; permission requests are auto-answered", async () => {
  broadcast.reset()
  const fake = scriptedAcp({ onPrompt: () => new Promise(() => {}) }) // a turn that never ends on its own
  engine.__setSpawnImpl(fake.spawn)
  await engine.send("work")
  const { models, current } = await engine.listModels()
  assert.deepEqual(models, [{ value: "m1", displayName: "Model One" }])
  assert.equal(current, "m1")
  const child = fake.children[0]
  child.request("session/request_permission", { options: [{ optionId: "ok", kind: "allow_always" }] })
  await until(() => child.received.some((m) => m.result && m.result.outcome))
  const reply = child.received.find((m) => m.result && m.result.outcome)
  assert.deepEqual(reply.result, { outcome: { outcome: "selected", optionId: "ok" } })
  await engine.interrupt()
  assert.equal(engine.state().busy, false)
  assert.ok(child.received.some((m) => m.method === "session/cancel" && m.params.sessionId === "s1" && m.id === undefined))
})

test("a crash mid-turn emits an is_error result WITH the stderr tail, and the NEXT send respawns", async () => {
  broadcast.reset()
  const fake = scriptedAcp({ onPrompt: () => new Promise(() => {}) })
  engine.__setSpawnImpl(fake.spawn)
  await engine.send("go", "t1")
  // What the CLI printed on its way out — the piece that was previously lost with the container.
  fake.children[0].stderr.write("Error: cannot find module 'opencode-ai/dist/acp'\n")
  await new Promise((r) => setImmediate(r))
  fake.children[0].emit("exit", 1) // the agent process dies mid-prompt
  await until(() => /"is_error":true/.test(dump()))
  assert.match(dump(), /agent process exited \(code 1\)/)
  assert.match(dump(), /cannot find module 'opencode-ai\/dist\/acp'/)
  assert.equal(engine.state().busy, false)
  assert.match((engine.replayTurn("t1") || []).join("\n"), /"is_error":true/) // loop replay sees the failure too
  await engine.send("retry")
  await until(() => fake.children.length === 2) // fresh child, fresh initialize/session/new
  await until(() => fake.children[1].received.some((m) => m.method === "session/prompt"))
})

// --- Blank-boot recovery (meta-gated) ---
const agentMeta = require("./agentMeta")
const withStoredMeta = (meta) => {
  recovery.__reset(); agentMeta.__reset()
  process.env.AGENT_META_B64 = Buffer.from(JSON.stringify(meta)).toString("base64")
  return () => { delete process.env.AGENT_META_B64; agentMeta.__reset() }
}
// A loadSession-capable agent whose session/load is scripted per-test (throw = failed load).
function loadableAcp({ onLoad }) {
  const children = []
  const spawn = () => {
    const child = makeFakeAcpChild(async (method, params) => {
      if (method === "initialize") return { protocolVersion: 1, agentCapabilities: { loadSession: true } }
      if (method === "session/load") return onLoad(params)
      if (method === "session/new") return { sessionId: "s-fresh", models: null }
      if (method === "session/prompt") return { stopReason: "end_turn" }
      throw new Error(`unexpected ${method}`)
    })
    children.push(child)
    return child
  }
  return { spawn, children }
}

test("recovery preamble fires on a blank boot when stored meta proves prior work", async () => {
  broadcast.reset()
  const fake = scriptedAcp({})
  engine.__setSpawnImpl(fake.spawn)
  const cleanup = withStoredMeta({ turnCount: 2, repos: [{ dir: "app", branch: "feat/x", prUrl: "https://github.com/o/r/pull/9" }] })
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-acp-h2-")) // no persisted id → session/new
  await engine.send("pick the task back up")
  await until(() => fake.children[0].received.some((m) => m.method === "session/prompt"))
  const prompt = fake.children[0].received.find((m) => m.method === "session/prompt")
  assert.match(prompt.params.prompt[0].text, /^\[CONTEXT RECOVERY\]/)
  assert.match(prompt.params.prompt[0].text, /your working branch is `feat\/x`/) // concrete meta facts, not a scavenger hunt
  assert.match(prompt.params.prompt[0].text, /https:\/\/github\.com\/o\/r\/pull\/9/)
  assert.match(prompt.params.prompt[0].text, /pick the task back up/)
  cleanup()
})

test("without stored meta a brand-new session NEVER gets the preamble, even repo-less-blank", async () => {
  broadcast.reset()
  const fake = scriptedAcp({})
  engine.__setSpawnImpl(fake.spawn)
  recovery.__reset(); agentMeta.__reset()
  delete process.env.AGENT_META_B64
  await engine.send("hello, first task ever")
  await until(() => fake.children[0].received.some((m) => m.method === "session/prompt"))
  const prompt = fake.children[0].received.find((m) => m.method === "session/prompt")
  assert.equal(prompt.params.prompt[0].text, "hello, first task ever") // no false "you were restarted"
})

test("a GENUINE session/load this boot suppresses the preamble (the context is already replayed)", async () => {
  broadcast.reset()
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-acp-h3-"))
  require("./acp/acpSession").writeSessionId("prior-9")
  const fake = loadableAcp({ onLoad: () => null }) // replay would arrive as session/update notifications
  engine.__setSpawnImpl(fake.spawn)
  const cleanup = withStoredMeta({ turnCount: 5, repos: [{ dir: "app", branch: "main" }] }) // meta present — the LOAD must suppress it
  await engine.send("carry on")
  await until(() => fake.children[0].received.some((m) => m.method === "session/prompt"))
  assert.ok(!fake.children[0].received.some((m) => m.method === "session/new")) // resumed, never re-created
  const prompt = fake.children[0].received.find((m) => m.method === "session/prompt")
  assert.equal(prompt.params.sessionId, "prior-9")
  assert.equal(prompt.params.prompt[0].text, "carry on")
  cleanup()
})

test("a FAILED session/load falls back to session/new and gets the preamble (context truly lost)", async () => {
  broadcast.reset()
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-acp-h4-"))
  require("./acp/acpSession").writeSessionId("prior-gone")
  const fake = loadableAcp({ onLoad: () => { throw new Error("unknown session") } })
  engine.__setSpawnImpl(fake.spawn)
  const cleanup = withStoredMeta({ turnCount: 3, repos: [] })
  await engine.send("continue")
  await until(() => fake.children[0].received.some((m) => m.method === "session/prompt"))
  const prompt = fake.children[0].received.find((m) => m.method === "session/prompt")
  assert.equal(prompt.params.sessionId, "s-fresh")
  assert.match(prompt.params.prompt[0].text, /^\[CONTEXT RECOVERY\]/) // file existence alone must NOT suppress it
  cleanup()
})

test("a codex-like agent (no loadSession) gets the preamble even with a stale persisted id", async () => {
  broadcast.reset()
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-acp-h5-"))
  require("./acp/acpSession").writeSessionId("prior-ignored") // codex cannot load it
  const fake = scriptedAcp({})
  engine.__setSpawnImpl(fake.spawn)
  const cleanup = withStoredMeta({ turnCount: 1, repos: [] })
  await engine.send("resume")
  await until(() => fake.children[0].received.some((m) => m.method === "session/prompt"))
  const prompt = fake.children[0].received.find((m) => m.method === "session/prompt")
  assert.match(prompt.params.prompt[0].text, /^\[CONTEXT RECOVERY\]/)
  cleanup()
})

test("a failed start never burns the once-per-boot recovery latch — the retry still gets it", async () => {
  broadcast.reset()
  const broken = { spawn: () => makeFakeAcpChild(async () => { throw new Error("agent exploded on initialize") }) }
  engine.__setSpawnImpl(broken.spawn)
  const cleanup = withStoredMeta({ turnCount: 4, repos: [] })
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-acp-h6-"))
  await engine.send("first try")
  await until(() => /"is_error":true/.test(dump())) // startup failure surfaced as an error result…
  const fake = scriptedAcp({})
  engine.__setSpawnImpl(fake.spawn) // …user relaunches/agent recovers; latch must still be intact
  await engine.send("second try")
  await until(() => fake.children[0].received.some((m) => m.method === "session/prompt"))
  const prompt = fake.children[0].received.find((m) => m.method === "session/prompt")
  assert.match(prompt.params.prompt[0].text, /^\[CONTEXT RECOVERY\]/)
  assert.match(prompt.params.prompt[0].text, /second try/)
  cleanup()
})

test("an auth-required session/new surfaces the login URL in chat + an auth_required result, then retries", async () => {
  broadcast.reset()
  const fake = scriptedAcp({
    onNew: () => { throw Object.assign(new Error("Authentication required"), { code: 401, data: { loginUrl: "https://login.example/device" } }) },
  })
  engine.__setSpawnImpl(fake.spawn)
  await engine.send("hi") // resolves — the failure is reported on the stream, not thrown at the caller
  await until(() => /"auth_required"/.test(dump()))
  const lines = broadcast.snapshot().map((l) => JSON.parse(l))
  assert.match(lines[0].message.content[0].text, /https:\/\/login\.example\/device/)
  assert.deepEqual(lines[1], { type: "result", is_error: true, error: "Authentication required", subtype: "auth_required" })
  assert.equal(engine.state().busy, false)
  await engine.send("after login")
  await until(() => fake.children.length === 2) // next send retried initialize + session/new
})

test("a child exit DURING the meta await drops the prompt but keeps the recovery latch for the retry", async () => {
  broadcast.reset()
  recovery.__reset(); agentMeta.__reset()
  delete process.env.AGENT_META_B64
  // Pre-seed the single-flight meta cache with a fetch WE control, so the engine's maybeRecover
  // parks on it while the child dies underneath.
  let releaseMeta
  agentMeta.loadStoredMeta({
    env: { ORCHESTRATOR_URL: "https://orch.example", OYREN_SESSION_SLUG: "sl", CONTROL_TOKEN: "ct" },
    fetchImpl: () => new Promise((res) => { releaseMeta = () => res({ ok: true, json: async () => ({ meta: { turnCount: 6 } }) }) }),
  })
  const fake = scriptedAcp({})
  engine.__setSpawnImpl(fake.spawn)
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-acp-h7-"))
  const sent = engine.send("first")
  await until(() => /"subtype":"init"/.test(dump())) // handshake done → send is parked on the meta fetch
  fake.children[0].emit("exit", 1) // the ACP child dies while send() awaits the meta
  releaseMeta()
  await sent
  assert.match(dump(), /exited before the prompt was dispatched/) // the prompt was dropped with an error…
  await engine.send("second try")
  await until(() => fake.children.length === 2 && fake.children[1].received.some((m) => m.method === "session/prompt"))
  const prompt = fake.children[1].received.find((m) => m.method === "session/prompt")
  assert.match(prompt.params.prompt[0].text, /^\[CONTEXT RECOVERY\]/) // …but the latch survived for the retry
  assert.match(prompt.params.prompt[0].text, /second try/)
  agentMeta.__reset(); recovery.__reset()
})
