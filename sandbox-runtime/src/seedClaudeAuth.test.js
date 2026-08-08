const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { seedClaudeAuth } = require("./seedClaudeAuth")

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-claude-home-"))

test("seeds ~/.claude.json with onboarding + workspace trust when CLAUDE_CODE_OAUTH_TOKEN is set", () => {
  const home = tmpHome()
  const seeded = seedClaudeAuth({ home, env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x" }, workdir: "/workspace" })
  assert.equal(seeded, true)
  const json = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
  // Onboarding + per-folder trust so the first interactive `claude` lands ready, no prompts.
  assert.equal(json.hasCompletedOnboarding, true)
  assert.equal(json.projects["/workspace"].hasTrustDialogAccepted, true)
})

test("does nothing (writes no file) when there is no subscription token", () => {
  const home = tmpHome()
  const seeded = seedClaudeAuth({ home, env: {}, workdir: "/workspace" })
  assert.equal(seeded, false)
  assert.equal(fs.existsSync(path.join(home, ".claude.json")), false)
  // Neither the onboarding file nor the OAuth credentials file may be created without a token.
  assert.equal(fs.existsSync(path.join(home, ".claude", ".credentials.json")), false)
})

test("seeds ~/.claude/.credentials.json so INTERACTIVE claude is authenticated (it ignores the env var)", () => {
  const home = tmpHome()
  seedClaudeAuth({ home, env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-abc" }, workdir: "/workspace" })
  const credsPath = path.join(home, ".claude", ".credentials.json")
  const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"))
  // The injected env token must land in accessToken (where interactive `claude` reads it from).
  assert.equal(creds.claudeAiOauth.accessToken, "sk-ant-oat01-abc")
  assert.equal(creds.claudeAiOauth.refreshToken, "") // setup-token never refreshes
  assert.ok(creds.claudeAiOauth.expiresAt > Date.now()) // far-future expiry
  assert.deepEqual(creds.claudeAiOauth.scopes, ["user:inference", "user:profile"])
})

test("the credentials file is written 0600 (token readable only by the container user)", () => {
  const home = tmpHome()
  seedClaudeAuth({ home, env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-abc" }, workdir: "/workspace" })
  const mode = fs.statSync(path.join(home, ".claude", ".credentials.json")).mode & 0o777
  assert.equal(mode, 0o600)
})

test("merges into an existing ~/.claude.json without clobbering other keys", () => {
  const home = tmpHome()
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({ oauthAccount: "keep-me", projects: { "/other": { hasTrustDialogAccepted: true } } }),
  )
  seedClaudeAuth({ home, env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x" }, workdir: "/workspace" })
  const json = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
  assert.equal(json.oauthAccount, "keep-me") // unrelated key preserved
  assert.equal(json.projects["/other"].hasTrustDialogAccepted, true) // existing project preserved
  assert.equal(json.projects["/workspace"].hasTrustDialogAccepted, true) // new trust added
})
