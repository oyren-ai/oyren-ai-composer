process.env.SESSION_TOKEN = "tok" // config reads this at require-time
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path")
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-control-"))
const { test } = require("node:test")
const assert = require("node:assert")
const engine = require("./agentEngine")
const { handleAgentInterrupt, handleAgentModels, handleAgentModel } = require("./agentControl")
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
