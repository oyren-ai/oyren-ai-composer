const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { readUpdateStatus, updateStatus } = require("./controlUpdate")

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "control-update-")), "update-status.json")

test("readUpdateStatus tolerates a missing or malformed file", () => {
  assert.equal(readUpdateStatus({ file: "/nonexistent/update-status.json" }), null)
  const file = tmp()
  fs.writeFileSync(file, "{nope")
  assert.equal(readUpdateStatus({ file }), null)
})

test("updateStatus pairs the image summary with the updater's status file", () => {
  const status = tmp()
  fs.writeFileSync(status, JSON.stringify({ state: "running", step: "applying:claude", from: "a", to: "b" }))
  const manifest = tmp()
  fs.writeFileSync(manifest, JSON.stringify({ version: "a", family: "base", components: { runtime: "t-1" } }))
  process.env.OYREN_IMAGE_MANIFEST = manifest
  try {
    const s = updateStatus({ file: status })
    assert.equal(s.image.version, "a")
    assert.equal(s.update.step, "applying:claude")
  } finally { delete process.env.OYREN_IMAGE_MANIFEST }
  assert.equal(updateStatus({ file: "/nonexistent" }).update, null)
})
