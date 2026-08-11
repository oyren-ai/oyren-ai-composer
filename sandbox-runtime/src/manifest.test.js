const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { readManifest, setManifestPort, manifestPath } = require("./manifest")

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oyren-manifest-"))
}

test("readManifest returns {} when no manifest exists", () => {
  assert.deepEqual(readManifest(tmpDir()), {})
})

test("setManifestPort creates oyren.yml with the port", () => {
  const dir = tmpDir()
  setManifestPort(dir, 3000)
  assert.equal(manifestPath(dir), path.join(dir, "oyren.yml"))
  assert.equal(readManifest(dir).port, 3000)
})

test("setManifestPort merges into an existing manifest, preserving other fields", () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, "oyren.yml"), "install: pnpm install\nstart: pnpm start\nport: 8080\n")
  const merged = setManifestPort(dir, 4000)
  assert.equal(merged.port, 4000)
  assert.equal(merged.start, "pnpm start")
  assert.equal(readManifest(dir).install, "pnpm install")
})

test("setManifestPort coerces a string port to a number", () => {
  const dir = tmpDir()
  setManifestPort(dir, "5173")
  assert.strictEqual(readManifest(dir).port, 5173)
})