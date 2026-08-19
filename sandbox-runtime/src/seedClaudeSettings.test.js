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
  // Self-update can never succeed on a pinned root-installed CLI — silence it for every session.
  assert.equal(json.env.DISABLE_AUTOUPDATER, "1")
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
    JSON.stringify({ model: "keep-me", permissions: { allow: ["Bash(ls:*)"] }, env: { FOO: "bar" } }),
  )
  seedClaudeSettings({ home })
  const json = readSettings(home)
  assert.equal(json.model, "keep-me") // unrelated top-level key preserved
  assert.deepEqual(json.permissions.allow, ["Bash(ls:*)"]) // existing permissions sub-key preserved
  assert.equal(json.permissions.defaultMode, "bypassPermissions") // new mode added
  assert.equal(json.skipDangerousModePermissionPrompt, true)
  assert.equal(json.env.FOO, "bar") // existing env keys preserved
  assert.equal(json.env.DISABLE_AUTOUPDATER, "1")
})
