const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { seedClaudeSettings } = require("./seedClaudeSettings")

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-claude-settings-"))
const readSettings = (home) => JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"))

test("seeds settings.json with bypassPermissions mode AND the disclaimer-skip flag", () => {
  const home = tmpHome()
  const seeded = seedClaudeSettings({ home })
  assert.equal(seeded, true)
  const json = readSettings(home)
  // Mode alone is silently downgraded to "default" — both keys are required for unattended bypass.
  assert.equal(json.permissions.defaultMode, "bypassPermissions")
  assert.equal(json.skipDangerousModePermissionPrompt, true)
  // Honoured in "default" mode too, so even a downgraded session runs unattended.
  assert.deepEqual(json.permissions.allow, ["Bash", "Edit", "Write", "WebFetch", "WebSearch"])
})

test("creates ~/.claude when it does not exist yet", () => {
  const home = tmpHome()
  assert.equal(fs.existsSync(path.join(home, ".claude")), false)
  seedClaudeSettings({ home })
  assert.equal(fs.existsSync(path.join(home, ".claude", "settings.json")), true)
})

test("merges into an existing settings.json without clobbering other keys", () => {
  const home = tmpHome()
  const dir = path.join(home, ".claude")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify({ model: "keep-me", permissions: { allow: ["Bash(ls:*)"] } }),
  )
  seedClaudeSettings({ home })
  const json = readSettings(home)
  assert.equal(json.model, "keep-me") // unrelated top-level key preserved
  assert.equal(json.permissions.allow[0], "Bash(ls:*)") // existing rule preserved, and kept first
  assert.ok(json.permissions.allow.includes("Bash")) // defaults unioned in behind it
  assert.equal(json.permissions.defaultMode, "bypassPermissions") // new mode added
  assert.equal(json.skipDangerousModePermissionPrompt, true)
})

test("re-seeding does not duplicate allow rules", () => {
  const home = tmpHome()
  seedClaudeSettings({ home })
  seedClaudeSettings({ home }) // every boot re-seeds; the list must not grow
  const { allow } = readSettings(home).permissions
  assert.deepEqual(allow, [...new Set(allow)])
})
