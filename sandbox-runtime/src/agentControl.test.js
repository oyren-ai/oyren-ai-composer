process.env.SESSION_TOKEN = "tok" // config reads this at require-time
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path")
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-control-"))
const { test } = require("node:test")
const assert = require("node:assert")
const engine = require("./agentEngine")
const { handleAgentInterrupt, handleAgentModels, handleAgentModel, handleAgentAuth } = require("./agentControl")
const { drive, makeFakeSdk } = require("./agentFakes")

test("interrupt endpoint requires the token then calls the engine", async () => {
  const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  await engine.send("work")
  const noAuth = await drive(handleAgentInterrupt, { method: "POST", url: "/agent/interrupt" })
  assert.equal(noAuth.status, 401)
  const res = await drive(handleAgentInterrupt, { method: "POST", url: "/agent/interrupt?token=tok" })
  assert.equal(res.status, 200)
  assert.equal(sdk.calls.interrupt, 1)
  assert.equal(engine.state().busy, false)
})

test("GET /agent/models returns the supported models + current", async () => {
  const sdk = makeFakeSdk({ models: [{ value: "opus", displayName: "Opus" }, { value: "sonnet", displayName: "Sonnet" }] })
  engine.__setQueryImpl(sdk.query)
  const res = await drive(handleAgentModels, { method: "GET", url: "/agent/models?token=tok" })
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(res.body()).models.length, 2)
})

test("POST /agent/model switches the model; a missing model is 400", async () => {
  const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  const bad = await drive(handleAgentModel, { method: "POST", url: "/agent/model?token=tok", body: "{}" })
  assert.equal(bad.status, 400)
  const res = await drive(handleAgentModel, { method: "POST", url: "/agent/model?token=tok", body: JSON.stringify({ model: "opus" }) })
  assert.equal(res.status, 200)
  assert.deepEqual(sdk.calls.setModel, ["opus"])
})

// GET /agent/auth — the Chat v2 T2 contract: {kind, hasCredential} per agent, launch flagged, side
// kinds evaluated against the AGENT_SIDE_AUTH_B64 overlay, no files touched, no network.
const sideAuth = require("./sideAgentAuth")
const authEnv = (extra = {}) => ({ AGENT_KIND: "claude-code", ...extra })
const driveAuth = (env, urlStr = "/agent/auth?token=tok", method = "GET") =>
  drive((q, s) => handleAgentAuth(q, s, { env }), { method, url: urlStr })

test("GET /agent/auth requires the token and only GET", async () => {
  assert.equal((await driveAuth(authEnv(), "/agent/auth")).status, 401)
  assert.equal((await driveAuth(authEnv(), "/agent/auth?token=tok", "POST")).status, 405)
})

test("GET /agent/auth: launch kind flagged, every side kind reported, overlay counts, unknown kind is null", async () => {
  sideAuth.__reset()
  const overlay = Buffer.from(JSON.stringify({ "codex-cli": { OPENAI_API_KEY: "sk-side" } })).toString("base64")
  const res = await driveAuth(authEnv({ ANTHROPIC_API_KEY: "sk-launch", AGENT_SIDE_AUTH_B64: overlay }))
  assert.equal(res.status, 200)
  const { agents } = JSON.parse(res.body())
  const byKind = Object.fromEntries(agents.map((a) => [a.kind, a]))
  assert.deepEqual(byKind["claude-code"], { kind: "claude-code", hasCredential: true, launch: true })
  assert.deepEqual(byKind["codex-cli"], { kind: "codex-cli", hasCredential: true, launch: false }) // via the overlay only
  assert.equal(byKind["gemini-cli"].hasCredential, false) // no overlay, no env, no file
  assert.equal(byKind["cursor-cli"].hasCredential, false) // the re-keyed entry resolves
  assert.equal(byKind["antigravity-cli"].hasCredential, null) // no contract → honest unknown
  assert.equal(agents.filter((a) => a.launch).length, 1)
  assert.equal(agents.length, 7) // launch + the 6 spawn-table kinds (launch never listed twice)
})

test("GET /agent/auth: an ACP launch kind is the flagged one and claude-code is absent", async () => {
  sideAuth.__reset()
  const res = await driveAuth({ AGENT_KIND: "gemini-cli", GEMINI_API_KEY: "g-key" })
  const { agents } = JSON.parse(res.body())
  assert.deepEqual(agents[0], { kind: "gemini-cli", hasCredential: true, launch: true })
  assert.ok(!agents.some((a) => a.kind === "claude-code"), "claude-code only appears when it IS the launch kind")
  assert.equal(agents.length, 6)
})
