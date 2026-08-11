const fs = require("fs")
const path = require("path")

// A `claude setup-token` is long-lived (1yr) and never refreshes, so a far-future expiry is stable for
// the container's whole life. Interactive `claude` (a TTY) reads its OAuth creds from this file and does
// NOT read CLAUDE_CODE_OAUTH_TOKEN (that var is honored only in headless/`-p` mode) — so writing this
// file is what actually makes a fresh container's interactive `claude` start already authenticated.
const FAR_FUTURE_EXPIRY = 4102444800000 // 2100-01-01

function writeCredentials(home, token) {
  const dir = path.join(home, ".claude")
  fs.mkdirSync(dir, { recursive: true })
  const creds = {
    claudeAiOauth: {
      accessToken: token,
      refreshToken: "",
      expiresAt: FAR_FUTURE_EXPIRY,
      scopes: ["user:inference", "user:profile"],
      subscriptionType: "max",
    },
  }
  // 0600: the token is a credential — keep it readable only by the container user.
  fs.writeFileSync(path.join(dir, ".credentials.json"), JSON.stringify(creds), { mode: 0o600 })
}

function writeOnboarding(file, workdir) {
  let current = {}
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8")) || {}
  } catch {
    current = {} // no file yet (or unreadable) → start fresh
  }
  const projects = { ...(current.projects || {}) }
  projects[workdir] = { ...(projects[workdir] || {}), hasTrustDialogAccepted: true }
  fs.writeFileSync(file, JSON.stringify({ ...current, hasCompletedOnboarding: true, projects }, null, 2))
}

/**
 * When a Claude Code subscription setup-token is present (CLAUDE_CODE_OAUTH_TOKEN, injected by the
 * orchestrator), pre-authenticate a fresh container so the first interactive `claude` lands logged in:
 *  - ~/.claude/.credentials.json — the OAuth creds interactive `claude` actually authenticates from.
 *  - ~/.claude.json — onboarding + per-folder trust so there are no first-run prompts.
 *
 * Idempotent + best-effort: merges into any existing ~/.claude.json (never clobbers other keys), and a
 * read/write failure must never crash container boot (the caller swallows throws).
 */
function seedClaudeAuth({ home = process.env.HOME || "/home/oyren", env = process.env, workdir = "/workspace" } = {}) {
  const token = env.CLAUDE_CODE_OAUTH_TOKEN
  if (!token) return false
  writeCredentials(home, token)
  writeOnboarding(path.join(home, ".claude.json"), workdir)
  return true
}

module.exports = { seedClaudeAuth }
