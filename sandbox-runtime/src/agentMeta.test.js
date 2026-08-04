const { test, beforeEach } = require("node:test")
const assert = require("node:assert")
const meta = require("./agentMeta")

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64")
const fullEnv = (extra = {}) => ({ ORCHESTRATOR_URL: "https://orch.example", OYREN_SESSION_SLUG: "slug-1", CONTROL_TOKEN: "tok-1", ...extra })

beforeEach(() => meta.__reset())

test("fetchMeta POSTs the fetch form (appSlug + controlToken, NO meta key) and returns the stored blob", async () => {
  let seen
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ meta: { turnCount: 7 } }) } }
  const got = await meta.fetchMeta({ env: fullEnv(), fetchImpl })
  assert.deepEqual(got, { turnCount: 7 })
  assert.equal(seen.url, "https://orch.example/sandbox/agent-meta")
  assert.equal(seen.opts.method, "POST")
  assert.deepEqual(JSON.parse(seen.opts.body), { appSlug: "slug-1", controlToken: "tok-1" }) // fetch form — no meta key
  assert.ok(seen.opts.signal, "bounded by a timeout signal")
})

test("a genuine 'nothing stored' answer is authoritative — env B64 is NOT consulted", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ meta: null }) })
  assert.equal(await meta.fetchMeta({ env: fullEnv({ AGENT_META_B64: b64({ turnCount: 3 }) }), fetchImpl }), null)
})

test("fetch failure (throw or non-2xx) falls back to decoding AGENT_META_B64", async () => {
  const env = fullEnv({ AGENT_META_B64: b64({ turnCount: 3, repos: [] }) })
  assert.deepEqual(await meta.fetchMeta({ env, fetchImpl: async () => { throw new Error("down") } }), { turnCount: 3, repos: [] })
  assert.deepEqual(await meta.fetchMeta({ env, fetchImpl: async () => ({ ok: false }) }), { turnCount: 3, repos: [] })
})

test("without orchestrator env vars the fetch is skipped entirely; garbage/absent B64 → null", async () => {
  let called = 0
  const fetchImpl = async () => { called++; return { ok: true, json: async () => ({ meta: {} }) } }
  assert.equal(await meta.fetchMeta({ env: {}, fetchImpl }), null)
  assert.equal(await meta.fetchMeta({ env: { AGENT_META_B64: "not!!base64!!json" }, fetchImpl }), null)
  assert.deepEqual(await meta.fetchMeta({ env: { AGENT_META_B64: b64({ turnCount: 1 }) }, fetchImpl }), { turnCount: 1 })
  assert.equal(called, 0)
})

test("loadStoredMeta fetches once per boot and caches the result", async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ meta: { turnCount: 2 } }) } }
  const first = await meta.loadStoredMeta({ env: fullEnv(), fetchImpl })
  const second = await meta.loadStoredMeta({ env: fullEnv(), fetchImpl })
  assert.deepEqual(first, { turnCount: 2 })
  assert.equal(second, first)
  assert.equal(calls, 1)
})

test("bumpTurnCount counts this boot's user turns; __reset clears it", () => {
  assert.equal(meta.localTurnCount(), 0)
  meta.bumpTurnCount(); meta.bumpTurnCount()
  assert.equal(meta.localTurnCount(), 2)
  meta.__reset()
  assert.equal(meta.localTurnCount(), 0)
})
