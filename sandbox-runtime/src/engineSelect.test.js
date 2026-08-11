const { test } = require("node:test")
const assert = require("node:assert")

// engineSelect decides at require time, so re-require it fresh per AGENT_KIND value.
function freshSelect(kind) {
  if (kind === undefined) delete process.env.AGENT_KIND
  else process.env.AGENT_KIND = kind
  delete require.cache[require.resolve("./engineSelect")]
  try { return require("./engineSelect") } finally { delete process.env.AGENT_KIND }
}

test("claude-code — and an unset AGENT_KIND — keep the SDK engine", () => {
  assert.equal(freshSelect("claude-code"), require("./agentEngine"))
  assert.equal(freshSelect(undefined), require("./agentEngine"))
  assert.equal(freshSelect(""), require("./agentEngine"))
})

test("every other agent kind routes to the ACP engine", () => {
  for (const kind of ["codex-cli", "gemini-cli", "qwen-code", "opencode", "cursor-cli", "antigravity-cli"]) {
    assert.equal(freshSelect(kind), require("./acpEngine"), kind)
  }
})

test("both engines expose the interface agentChat/agentControl consume", () => {
  for (const mod of [require("./agentEngine"), require("./acpEngine")]) {
    for (const fn of ["send", "interrupt", "listModels", "setModel", "state", "replayTurn"]) {
      assert.equal(typeof mod[fn], "function", fn)
    }
  }
})
