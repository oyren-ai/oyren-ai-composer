import test from "node:test"
import assert from "node:assert/strict"
import { IMAGE_KEYS, buildBody, describe, releaseKeys, sourceFrom, targetsFrom } from "./imageRegistry.mjs"

const base = { family: "base", version: "2026-08-26-0900", imageId: 242661992, region: "fra1" }

test("buildBody names the image the way promote-snapshot.sh renamed it", () => {
  const body = buildBody(base)
  assert.equal(body.key, IMAGE_KEYS.base)
  assert.equal(body.doImageName, "oyren-sandbox-base-2026-08-26-0900")
  assert.equal(body.doImageId, "242661992", "the id is stringified: DO answers a number, the table stores text")
})

test("buildBody carries the release keys publish-release.sh wrote", () => {
  const body = buildBody(base)
  assert.deepEqual(
    { manifestKey: body.manifestKey, tarballKey: body.tarballKey },
    releaseKeys("base", "2026-08-26-0900"),
  )
  assert.equal(body.manifestKey, "sandbox-releases/base/2026-08-26-0900/manifest.json")
})

test("a bake run without publish registers the image with no release keys", () => {
  const body = buildBody({ ...base, published: false })
  assert.equal(body.manifestKey, undefined)
  assert.equal(body.tarballKey, undefined)
})

test("the tarball hash comes from the built manifest, and is omitted when there is none", () => {
  const sha = "a".repeat(64)
  assert.equal(buildBody({ ...base, manifest: { artifact: { sha256: sha } } }).tarballSha256, sha)
  assert.equal(buildBody(base).tarballSha256, undefined)
  assert.equal(buildBody({ ...base, manifest: { version: "x" } }).tarballSha256, undefined)
})

test("optional fields are left out rather than sent empty", () => {
  const body = buildBody({ ...base, composerSha: "", source: "" })
  assert.equal("composerSha" in body, false)
  assert.equal("source" in body, false)
  assert.equal(buildBody({ ...base, composerSha: "ca4e005", source: "run/1" }).composerSha, "ca4e005")
})

test("the lean family maps to its own key and image name", () => {
  const body = buildBody({ ...base, family: "lean" })
  assert.equal(body.key, "CODESPACE_BASE_LEAN4_MATHLIB")
  assert.equal(body.doImageName, "oyren-sandbox-lean-2026-08-26-0900")
})

test("buildBody refuses what the orchestrator would refuse anyway, before the network", () => {
  assert.throws(() => buildBody({ ...base, family: "zed" }), /unknown family "zed"/)
  assert.throws(() => buildBody({ ...base, version: "2026-8-26" }), /must look like/)
  assert.throws(() => buildBody({ ...base, imageId: "" }), /--image-id is required/)
})

test("targetsFrom pairs each name with its own URL and token, trailing slash trimmed", () => {
  const env = {
    ORCHESTRATOR_URL_DEV: "https://api.oyren.dev/", IMAGE_REGISTRY_TOKEN_DEV: "dev-token",
    ORCHESTRATOR_URL_PROD: "https://api.oyren.ai", IMAGE_REGISTRY_TOKEN_PROD: "prod-token",
  }
  assert.deepEqual(targetsFrom(env, ["dev", "prod"]), [
    { name: "dev", url: "https://api.oyren.dev", token: "dev-token" },
    { name: "prod", url: "https://api.oyren.ai", token: "prod-token" },
  ])
})

test("targetsFrom fails loudly on missing config instead of POSTing nowhere", () => {
  assert.throws(() => targetsFrom({}, ["prod"]), /ORCHESTRATOR_URL_PROD is not set/)
  assert.throws(() => targetsFrom({ ORCHESTRATOR_URL_PROD: "u" }, ["prod"]), /IMAGE_REGISTRY_TOKEN_PROD is not set/)
})

test("sourceFrom is the GitHub run URL, and empty off CI", () => {
  assert.equal(sourceFrom({ GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/c", GITHUB_RUN_ID: "7" }), "https://github.com/o/c/actions/runs/7")
  assert.equal(sourceFrom({}), "")
})

test("describe distinguishes a first registration from a re-run and from a failure", () => {
  assert.match(describe({ name: "prod", ok: true, created: true, status: 201 }), /✅ prod: registered/)
  assert.match(describe({ name: "prod", ok: true, created: false, status: 200 }), /already registered/)
  assert.match(describe({ name: "dev", ok: false, status: 409, detail: "taken" }), /❌ dev: 409 taken/)
  assert.match(describe({ name: "dev", ok: false, status: 0, detail: "fetch failed" }), /no reply fetch failed/)
})
