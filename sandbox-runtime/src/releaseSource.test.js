const { test } = require("node:test")
const assert = require("node:assert/strict")
const { fetchLatestRelease, ReleaseError } = require("./releaseSource")

const ENV = { ORCHESTRATOR_URL: "https://api.example/", OYREN_SESSION_SLUG: "sb-1", CONTROL_TOKEN: "ct" }
const answer = (status, body) => async () => ({ status, ok: status < 300, json: async () => body })

test("asks /sandbox/release with the session's credentials and returns the release", async () => {
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 200, ok: true, json: async () => ({ version: "2026-08-25-1838", family: "base", manifestUrl: "https://m", tarballUrl: "https://t", expiresAt: "soon" }) } }
  const r = await fetchLatestRelease({ env: ENV, fetchImpl, family: "base" })
  assert.equal(calls[0].url, "https://api.example/sandbox/release")
  assert.deepEqual(JSON.parse(calls[0].init.body), { appSlug: "sb-1", controlToken: "ct", family: "base" })
  assert.deepEqual(r, { version: "2026-08-25-1838", family: "base", manifestUrl: "https://m", tarballUrl: "https://t", expiresAt: "soon" })
})

test("without an orchestrator link it says so and names the manual flags", async () => {
  await assert.rejects(fetchLatestRelease({ env: {}, fetchImpl: answer(200, {}) }), (e) => e instanceof ReleaseError && e.code === "no-link" && /--manifest-url/.test(e.message))
})

test("HTTP outcomes become plain-language errors with a next step", async () => {
  for (const [status, code, re] of [[403, "forbidden", /control token/], [404, "none", /no release has been published/], [429, "rate-limited", /wait/], [501, "unsupported", /releases bucket/], [500, "failed", /500/]]) {
    await assert.rejects(fetchLatestRelease({ env: ENV, fetchImpl: answer(status, {}) }), (e) => e.code === code && re.test(e.message), `status ${status}`)
  }
  await assert.rejects(fetchLatestRelease({ env: ENV, fetchImpl: async () => { throw new Error("ECONNREFUSED") } }), (e) => e.code === "unreachable" && /ECONNREFUSED/.test(e.message))
  await assert.rejects(fetchLatestRelease({ env: ENV, fetchImpl: answer(200, { version: "x" }) }), (e) => e.code === "malformed")
})
