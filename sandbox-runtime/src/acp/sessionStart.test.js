const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { handshake, openSession } = require("./sessionStart")
const acpSession = require("./acpSession")

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-sess-start-"))

// A scripted rpc: answers each method from the map (throwing when the value is an Error) + records calls.
function fakeRpc(answers) {
  const calls = []
  return { calls, request: async (method, params) => {
    calls.push({ method, params })
    const a = answers[method]
    if (a instanceof Error) throw a
    if (!(method in answers)) throw new Error(`unexpected ${method}`)
    return typeof a === "function" ? a(params) : a
  } }
}

test("a persisted id + loadSession capability resumes via session/load (no session/new)", async () => {
  const home = tmpHome()
  acpSession.writeSessionId("prior-1", home)
  const rpc = fakeRpc({ "session/load": null })
  const got = await openSession(rpc, { cwd: "/w", mcpServers: [{ url: "u" }], agentCapabilities: { loadSession: true }, home })
  assert.deepEqual(got, { sessionId: "prior-1", models: null, loaded: true })
  assert.equal(rpc.calls.length, 1)
  assert.equal(rpc.calls[0].method, "session/load")
  assert.deepEqual(rpc.calls[0].params, { sessionId: "prior-1", cwd: "/w", mcpServers: [{ url: "u" }] })
})

test("a failed session/load falls back to session/new and persists the fresh id", async () => {
  const home = tmpHome()
  acpSession.writeSessionId("stale-1", home)
  const rpc = fakeRpc({ "session/load": new Error("unknown session"), "session/new": { sessionId: "fresh-2", models: { currentModelId: "m1" } } })
  const got = await openSession(rpc, { cwd: "/w", agentCapabilities: { loadSession: true }, home })
  assert.deepEqual(got, { sessionId: "fresh-2", models: { currentModelId: "m1" }, loaded: false })
  assert.equal(acpSession.readSessionId(home), "fresh-2") // stale id replaced for the next boot
})

test("no loadSession capability (codex) goes straight to session/new even with a persisted id", async () => {
  const home = tmpHome()
  acpSession.writeSessionId("prior-1", home)
  const rpc = fakeRpc({ "session/new": { sessionId: "s-new" } })
  const got = await openSession(rpc, { cwd: "/w", agentCapabilities: {}, home })
  assert.equal(got.sessionId, "s-new")
  assert.deepEqual(rpc.calls.map((c) => c.method), ["session/new"])
  assert.equal(acpSession.readSessionId(home), "s-new")
})

test("no persisted id starts fresh and persists the new one", async () => {
  const home = tmpHome()
  const rpc = fakeRpc({ "session/new": { sessionId: "first" } })
  const got = await openSession(rpc, { cwd: "/w", agentCapabilities: { loadSession: true }, home })
  assert.deepEqual(rpc.calls.map((c) => c.method), ["session/new"])
  assert.equal(got.loaded, false)
  assert.equal(acpSession.readSessionId(home), "first")
})

test("handshake initializes, threads the agent capabilities + env MCP servers into the open", async () => {
  const home = tmpHome()
  const env = { OYREN_MCP_SERVERS: JSON.stringify([{ name: "ws", url: "https://mcp.oyren.ai/x", token: "tk" }]) }
  const rpc = fakeRpc({
    initialize: { protocolVersion: 1, agentCapabilities: { loadSession: false, mcpCapabilities: { http: true } } },
    "session/new": { sessionId: "s1", models: { currentModelId: "m1" } },
  })
  const got = await handshake(rpc, { kind: "qwen-code", cwd: "/w", env, home, log: () => {} })
  assert.equal(got.sessionId, "s1")
  assert.deepEqual(rpc.calls.map((c) => c.method), ["initialize", "session/new"])
  assert.equal(rpc.calls[0].params.protocolVersion, 1)
  assert.equal(rpc.calls[1].params.cwd, "/w")
  assert.equal(rpc.calls[1].params.mcpServers[0].url, "https://mcp.oyren.ai/x") // http mcp advertised → passed
})

test("cursor-cli handshake authenticates with cursor_login before opening a session", async () => {
  const home = tmpHome()
  const rpc = fakeRpc({
    initialize: { protocolVersion: 1, agentCapabilities: {}, authMethods: [{ id: "cursor_login" }] },
    authenticate: {},
    "session/new": { sessionId: "cur-1" },
  })
  const got = await handshake(rpc, { kind: "cursor-cli", cwd: "/w", home, log: () => {} })
  assert.equal(got.sessionId, "cur-1")
  assert.deepEqual(rpc.calls.map((c) => c.method), ["initialize", "authenticate", "session/new"])
  assert.deepEqual(rpc.calls[1].params, { methodId: "cursor_login" })
})
