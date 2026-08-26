const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { writeHealth } = require("./health")

function makeRes() {
  return {
    statusCode: 0, headers: null, body: "",
    writeHead(s, h) { this.statusCode = s; this.headers = h; return this },
    end(b) { this.body = b || "" },
    json() { return JSON.parse(this.body) },
  }
}

function withManifest(manifest, fn) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "health-")), "image-manifest.json")
  if (manifest) fs.writeFileSync(file, JSON.stringify(manifest))
  process.env.OYREN_IMAGE_MANIFEST = file
  try { return fn() } finally { delete process.env.OYREN_IMAGE_MANIFEST }
}

test("health is always 200 and names the image the droplet runs", () => {
  withManifest({ version: "2026-08-25-1838", family: "base", components: { runtime: "t-abc123def456" } }, () => {
    const res = makeRes()
    writeHealth(res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers["content-type"], "application/json")
    const body = res.json()
    assert.equal(body.status, "healthy")
    assert.equal(body.service, "oyren-sandbox")
    assert.equal(body.imageVersion, "2026-08-25-1838")
    assert.equal(body.imageFamily, "base")
    assert.equal(body.runtime, "t-abc123def456")
  })
})

test("an image without a manifest still answers healthy, with null image fields", () => {
  withManifest(null, () => {
    const res = makeRes()
    writeHealth(res)
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.imageVersion, null)
    assert.equal(body.imageFamily, null)
    assert.equal(body.runtime, null)
    assert.equal(body.buildId, "unknown")
  })
})
