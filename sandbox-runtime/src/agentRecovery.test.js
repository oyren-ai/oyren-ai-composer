const { test, beforeEach } = require("node:test")
const assert = require("node:assert")
const { maybeRecover, recoveryPreamble, promptDropped, __reset } = require("./agentRecovery")
const agentMeta = require("./agentMeta")

const b64 = (meta) => Buffer.from(JSON.stringify(meta)).toString("base64")
const envWith = (meta, extra = {}) => ({ ...(meta ? { AGENT_META_B64: b64(meta) } : {}), ...extra })

beforeEach(() => { __reset(); agentMeta.__reset() })

test("no stored meta → NO preamble ever (a brand-new session must not be told it was restarted)", async () => {
  const env = envWith(null)
  assert.equal(await maybeRecover("hi", { env }), "hi")
  assert.equal(await maybeRecover("hi again", { env }), "hi again") // and the once-per-boot latch never burned
})

test("meta with zero turns and no concrete repo facts → no preamble (nothing to recover)", async () => {
  const env = envWith({ turnCount: 0, repos: [{ dir: "app", branch: null, prUrl: null, checkpointRef: null }] })
  assert.equal(await maybeRecover("hi", { env }), "hi")
})

test("meta with prior turns but no branch/PR → honest generic preamble", async () => {
  const got = await maybeRecover("continue please", { env: envWith({ turnCount: 3, repos: [] }) })
  assert.match(got, /^\[CONTEXT RECOVERY\] This container was restarted and your prior conversation was lost\./)
  assert.match(got, /Check git\/GitHub for pushed work/)
  assert.match(got, /`git log --oneline -30`/)
  assert.match(got, /ask the user to restate the task/)
  assert.ok(!got.includes("working branch"), "no invented branch facts")
  assert.match(got, /continue please$/) // original payload preserved below the preamble
})

test("meta with concrete repos → preamble states the actual branch / PR URL / checkpoint ref per repo", async () => {
  const meta = { turnCount: 5, repos: [
    { dir: "app", branch: "feat/x", prUrl: "https://github.com/o/r/pull/7", checkpointRef: "oyren/checkpoint-s1" },
    { dir: "lib", branch: "main", prUrl: null, checkpointRef: null },
  ] }
  const got = await maybeRecover("go on", { env: envWith(meta) })
  assert.match(got, /In `app`: your working branch is `feat\/x`; your draft PR is https:\/\/github\.com\/o\/r\/pull\/7 — its body is your plan\/checklist; checkpoint ref `oyren\/checkpoint-s1` may hold newer edits/)
  assert.match(got, /In `lib`: your working branch is `main`\./) // absent facts are omitted, never invented
  assert.match(got, /continue from the next unchecked step/)
  assert.match(got, /Do not re-introduce yourself or redo completed work/)
})

test("a content-block array payload gets the preamble as a leading text block", async () => {
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } }
  const got = await maybeRecover([image, { type: "text", text: "go on" }], { env: envWith({ turnCount: 1 }) })
  assert.equal(got.length, 3)
  assert.match(got[0].text, /\[CONTEXT RECOVERY\]/)
  assert.deepEqual(got.slice(1), [image, { type: "text", text: "go on" }])
})

test("fires at most once per boot — the second send passes through untouched", async () => {
  const env = envWith({ turnCount: 2 })
  await maybeRecover("first", { env })
  assert.equal(await maybeRecover("second", { env }), "second")
})

test("a genuinely resumed session (hasLocalSession) skips recovery — the context is already loaded", async () => {
  assert.equal(await maybeRecover("hi", { hasLocalSession: true, env: envWith({ turnCount: 9 }) }), "hi")
})

test("meta fetched from the orchestrator gates + enriches the preamble (env B64 not needed)", async () => {
  const env = { ORCHESTRATOR_URL: "https://orch.example", OYREN_SESSION_SLUG: "sl", CONTROL_TOKEN: "ct" }
  const fetchImpl = async () => ({ ok: true, json: async () => ({ meta: { turnCount: 1, repos: [{ dir: "r", branch: "b1" }] } }) })
  const got = await maybeRecover("hi", { env, fetchImpl })
  assert.match(got, /your working branch is `b1`/)
})

test("a failed fetch falls back to AGENT_META_B64", async () => {
  const env = envWith({ turnCount: 4 }, { ORCHESTRATOR_URL: "https://orch.example", OYREN_SESSION_SLUG: "sl", CONTROL_TOKEN: "ct" })
  const got = await maybeRecover("hi", { env, fetchImpl: async () => { throw new Error("boom") } })
  assert.match(got, /\[CONTEXT RECOVERY\]/)
})

test("recoveryPreamble renders the generic wording for meta without concrete repos", () => {
  assert.match(recoveryPreamble({ turnCount: 1 }), /restate the task/)
})

test("concurrent first sends on a blank boot: exactly ONE gets the preamble", async () => {
  const env = { ORCHESTRATOR_URL: "https://orch.example", OYREN_SESSION_SLUG: "sl", CONTROL_TOKEN: "ct" }
  const fetchImpl = async () => { await new Promise((r) => setTimeout(r, 5)); return { ok: true, json: async () => ({ meta: { turnCount: 2 } }) } }
  const [a, b] = await Promise.all([maybeRecover("first", { env, fetchImpl }), maybeRecover("second", { env, fetchImpl })])
  assert.equal([a, b].filter((got) => /\[CONTEXT RECOVERY\]/.test(got)).length, 1)
  assert.ok(/first$/.test(a) && /second$/.test(b), "both payloads survive")
})

test("promptDropped un-latches ONLY when the dropped call had prepended the preamble", async () => {
  const env = envWith({ turnCount: 2 })
  const recovered = await maybeRecover("go", { env })
  assert.match(recovered, /\[CONTEXT RECOVERY\]/)
  assert.match(promptDropped("go", recovered).message, /exited before the prompt was dispatched/)
  assert.match(await maybeRecover("retry", { env }), /\[CONTEXT RECOVERY\]/) // latch restored → the retry still recovers
  const untouched = await maybeRecover("later", { env })
  assert.equal(untouched, "later") // latch consumed by the (dispatched) retry
  promptDropped("later", untouched) // dropping an UN-preambled prompt must NOT clear the latch
  assert.equal(await maybeRecover("after", { env }), "after")
})
