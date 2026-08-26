const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { readImageManifest, imageSummary } = require("./imageManifest")

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "image-manifest-")), "image-manifest.json")

const MANIFEST = {
  version: "2026-08-25-1838", family: "base", builtAt: "2026-08-25T18:38:00Z", composerSha: "342436e",
  components: { runtime: "t-abc123def456", claude: "2.1.235" },
}

test("a missing or unreadable manifest reads as null, never as a crash", () => {
  assert.equal(readImageManifest({ file: "/nonexistent/image-manifest.json" }), null)
  assert.equal(imageSummary({ file: "/nonexistent/image-manifest.json" }), null)
  const file = tmpFile()
  fs.writeFileSync(file, "{not json")
  assert.equal(readImageManifest({ file }), null)
})

test("imageSummary is the short form: version, family, build facts and the runtime hash", () => {
  const file = tmpFile()
  fs.writeFileSync(file, JSON.stringify(MANIFEST))
  assert.deepEqual(imageSummary({ file }), {
    version: "2026-08-25-1838", family: "base", builtAt: "2026-08-25T18:38:00Z", composerSha: "342436e", runtime: "t-abc123def456",
  })
})

test("a rewritten manifest is picked up without a restart (mtime changes invalidate the cache)", () => {
  const file = tmpFile()
  fs.writeFileSync(file, JSON.stringify(MANIFEST))
  assert.equal(readImageManifest({ file }).version, "2026-08-25-1838")
  const past = new Date(Date.now() - 60_000)
  fs.utimesSync(file, past, past)
  fs.writeFileSync(file, JSON.stringify({ ...MANIFEST, version: "2026-08-26-0910" }))
  assert.equal(readImageManifest({ file }).version, "2026-08-26-0910")
})

test("OYREN_IMAGE_MANIFEST overrides the default path", () => {
  const file = tmpFile()
  fs.writeFileSync(file, JSON.stringify(MANIFEST))
  process.env.OYREN_IMAGE_MANIFEST = file
  try { assert.equal(imageSummary().family, "base") } finally { delete process.env.OYREN_IMAGE_MANIFEST }
})
