import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findImageId, registerWith, runCli } from "./registerImage.mjs"

/** An orchestrator stand-in: records what it was sent and answers whatever the test asked for. */
async function orchestrator(reply) {
  const seen = []
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      seen.push({ url: req.url, method: req.method, authorization: req.headers.authorization, body: JSON.parse(body || "{}") })
      const { status, text } = reply(seen.length)
      res.writeHead(status, { "content-type": "application/json" })
      res.end(text)
    })
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) }
}

const always = (status, text = "{}") => () => ({ status, text })
const target = (url, name = "prod") => ({ name, url, token: "bake-token" })
const body = { key: "CODESPACE_BASE", version: "2026-08-26-0900", doImageId: "1", doImageName: "oyren-sandbox-base-2026-08-26-0900", region: "fra1" }

test("registerWith POSTs to /sandbox/images with the bearer and reports 201 as created", async () => {
  const api = await orchestrator(always(201, '{"uuid":"img-1"}'))
  try {
    const result = await registerWith(target(api.url), body)
    assert.deepEqual({ ok: result.ok, created: result.created, status: result.status }, { ok: true, created: true, status: 201 })
    assert.equal(api.seen[0].url, "/sandbox/images")
    assert.equal(api.seen[0].authorization, "Bearer bake-token")
    assert.deepEqual(api.seen[0].body, body)
  } finally { await api.close() }
})

test("200 is success but not a creation: a re-run changed nothing", async () => {
  const api = await orchestrator(always(200))
  try {
    const result = await registerWith(target(api.url), body)
    assert.equal(result.ok, true)
    assert.equal(result.created, false)
  } finally { await api.close() }
})

test("409 fails and carries the orchestrator's reason", async () => {
  const api = await orchestrator(always(409, '{"error":"already registered as image 111"}'))
  try {
    const result = await registerWith(target(api.url), body)
    assert.equal(result.ok, false)
    assert.match(result.detail, /already registered as image 111/)
  } finally { await api.close() }
})

test("401 fails without retrying: a wrong token is not a transient problem", async () => {
  const api = await orchestrator(always(401, '{"error":"Unauthorized"}'))
  try {
    const result = await registerWith(target(api.url), body)
    assert.equal(result.ok, false)
    assert.equal(result.status, 401)
    assert.equal(api.seen.length, 1)
  } finally { await api.close() }
})

test("an unreachable orchestrator is a failure, not a crash", async () => {
  const result = await registerWith({ name: "dev", url: "http://127.0.0.1:1", token: "t" }, body)
  assert.equal(result.ok, false)
  assert.equal(result.status, 0)
  assert.ok(result.detail.length > 0)
})

test("the CLI registers with every target and reads the tarball hash off the manifest", async () => {
  const api = await orchestrator(always(201))
  const dir = mkdtempSync(join(tmpdir(), "oyren-register-"))
  const manifest = join(dir, "manifest.base.json")
  writeFileSync(manifest, JSON.stringify({ version: "2026-08-26-0900", artifact: { sha256: "b".repeat(64) } }))
  const env = {
    ORCHESTRATOR_URL_DEV: api.url, IMAGE_REGISTRY_TOKEN_DEV: "dev-token",
    ORCHESTRATOR_URL_PROD: api.url, IMAGE_REGISTRY_TOKEN_PROD: "prod-token",
    GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "oyren-ai/oyren-ai-composer", GITHUB_RUN_ID: "7",
  }
  try {
    const passed = await runCli(
      ["--family", "base", "--version", "2026-08-26-0900", "--image-id", "242661992", "--region", "fra1", "--manifest", manifest, "--targets", "dev,prod"],
      env, globalThis.fetch, () => {},
    )
    assert.equal(passed, true)
    assert.equal(api.seen.length, 2)
    assert.deepEqual(api.seen.map((s) => s.authorization).sort(), ["Bearer dev-token", "Bearer prod-token"])
    assert.equal(api.seen[0].body.tarballSha256, "b".repeat(64))
    assert.equal(api.seen[0].body.source, "https://github.com/oyren-ai/oyren-ai-composer/actions/runs/7")
  } finally { await api.close() }
})

test("one target failing fails the run, and the other is still registered", async () => {
  const good = await orchestrator(always(201))
  const bad = await orchestrator(always(409, '{"error":"taken"}'))
  const env = {
    ORCHESTRATOR_URL_DEV: bad.url, IMAGE_REGISTRY_TOKEN_DEV: "dev-token",
    ORCHESTRATOR_URL_PROD: good.url, IMAGE_REGISTRY_TOKEN_PROD: "prod-token",
  }
  try {
    const passed = await runCli(["--version", "2026-08-26-0900", "--image-id", "1", "--targets", "dev,prod"], env, globalThis.fetch, () => {})
    assert.equal(passed, false)
    assert.equal(good.seen.length, 1, "a failing dev must not stop prod being recorded")
  } finally { await good.close(); await bad.close() }
})

test("--no-release registers an image with no release keys", async () => {
  const api = await orchestrator(always(201))
  const env = { ORCHESTRATOR_URL_PROD: api.url, IMAGE_REGISTRY_TOKEN_PROD: "t" }
  try {
    await runCli(["--version", "2026-08-26-0900", "--image-id", "1", "--targets", "prod", "--no-release"], env, globalThis.fetch, () => {})
    assert.equal(api.seen[0].body.manifestKey, undefined)
  } finally { await api.close() }
})

test("the CLI falls back to RELEASE_VERSION, COMPOSER_SHA and DO_REGION from the environment", async () => {
  const api = await orchestrator(always(201))
  const env = {
    ORCHESTRATOR_URL_PROD: api.url, IMAGE_REGISTRY_TOKEN_PROD: "t",
    RELEASE_VERSION: "2026-08-26-1200", COMPOSER_SHA: "ca4e005", DO_REGION: "nyc3",
  }
  try {
    await runCli(["--image-id", "9", "--targets", "prod"], env, globalThis.fetch, () => {})
    assert.deepEqual(
      { version: api.seen[0].body.version, composerSha: api.seen[0].body.composerSha, region: api.seen[0].body.region },
      { version: "2026-08-26-1200", composerSha: "ca4e005", region: "nyc3" },
    )
  } finally { await api.close() }
})

test("a missing manifest file is not fatal: the hash is simply absent", async () => {
  const api = await orchestrator(always(201))
  const env = { ORCHESTRATOR_URL_PROD: api.url, IMAGE_REGISTRY_TOKEN_PROD: "t" }
  try {
    await runCli(["--version", "2026-08-26-0900", "--image-id", "1", "--targets", "prod", "--manifest", "/nope/manifest.json"], env, globalThis.fetch, () => {})
    assert.equal(api.seen[0].body.tarballSha256, undefined)
  } finally { await api.close() }
})

test("--flag=value is accepted alongside --flag value", async () => {
  const api = await orchestrator(always(201))
  const env = { ORCHESTRATOR_URL_PROD: api.url, IMAGE_REGISTRY_TOKEN_PROD: "t" }
  try {
    await runCli(["--version=2026-08-26-0900", "--image-id=42", "--targets=prod"], env, globalThis.fetch, () => {})
    assert.equal(api.seen[0].body.doImageId, "42")
  } finally { await api.close() }
})

test("findImageId resolves a promoted image by the name promote-snapshot.sh gave it", async () => {
  const list = async () => [
    { id: 111, name: "oyren-sandbox-base-2026-08-20-0900" },
    { id: 242661992, name: "oyren-sandbox-base-2026-08-26-0900" },
    { id: 333, name: "candidate-oyren-sandbox-base-2026-08-26-0900" },
  ]
  assert.equal(await findImageId("base", "2026-08-26-0900", "do-token", list), "242661992")
})

test("findImageId says which name it looked for when nothing matches", async () => {
  await assert.rejects(
    () => findImageId("lean", "2026-08-26-0900", "do-token", async () => []),
    /no promoted image named oyren-sandbox-lean-2026-08-26-0900/,
  )
})

test("the CLI looks the image up when no id is given and a DO token is present", async () => {
  const api = await orchestrator(always(201))
  const env = { ORCHESTRATOR_URL_PROD: api.url, IMAGE_REGISTRY_TOKEN_PROD: "t", DO_API_TOKEN: "do-token" }
  const fakeDo = async () => new Response(JSON.stringify({ snapshots: [{ id: 777, name: "oyren-sandbox-base-2026-08-26-0900" }] }), { status: 200 })
  const realFetch = globalThis.fetch
  globalThis.fetch = (url, init) => (String(url).includes("digitalocean") ? fakeDo() : realFetch(url, init))
  try {
    await runCli(["--version", "2026-08-26-0900", "--targets", "prod"], env, globalThis.fetch, () => {})
    assert.equal(api.seen[0].body.doImageId, "777")
  } finally {
    globalThis.fetch = realFetch
    await api.close()
  }
})
