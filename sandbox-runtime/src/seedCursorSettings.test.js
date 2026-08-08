const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { seedCursorSettings } = require("./seedCursorSettings")

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-cursor-settings-"))
const readConfig = (home) => JSON.parse(fs.readFileSync(path.join(home, ".cursor", "cli-config.json"), "utf8"))

test("seeds cli-config.json with unrestricted approval and sandbox disabled", () => {
  const home = tmpHome()
  const seeded = seedCursorSettings({ home })
  assert.equal(seeded, true)
  const json = readConfig(home)
  assert.equal(json.version, 1)
  assert.equal(json.approvalMode, "unrestricted")
  assert.equal(json.sandbox.mode, "disabled")
  assert.equal(json.editor.vimMode, false)
  assert.ok(json.permissions.allow.includes("Shell(**)"))
  assert.ok(json.permissions.allow.includes("Write(**)"))
  assert.deepEqual(json.permissions.deny, [])
})

test("creates ~/.cursor when it does not exist yet", () => {
  const home = tmpHome()
  assert.equal(fs.existsSync(path.join(home, ".cursor")), false)
  seedCursorSettings({ home })
  assert.equal(fs.existsSync(path.join(home, ".cursor", "cli-config.json")), true)
})

test("merges into an existing cli-config.json without clobbering other keys", () => {
  const home = tmpHome()
  const dir = path.join(home, ".cursor")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, "cli-config.json"),
    JSON.stringify({
      version: 1,
      editor: { vimMode: true },
      permissions: { allow: ["Shell(ls)"], deny: ["Shell(rm)"] },
      maxMode: true,
    }),
  )
  seedCursorSettings({ home })
  const json = readConfig(home)
  assert.equal(json.maxMode, true) // unrelated top-level key preserved
  assert.equal(json.editor.vimMode, true) // existing editor preference preserved
  assert.ok(json.permissions.allow.includes("Shell(ls)")) // prior allow entry kept
  assert.ok(json.permissions.allow.includes("Shell(**)")) // broad pattern added
  assert.deepEqual(json.permissions.deny, ["Shell(rm)"]) // deny list preserved
  assert.equal(json.approvalMode, "unrestricted")
  assert.equal(json.sandbox.mode, "disabled")
})
