// Per-provider auth seeding for the non-Claude coding agents, mirroring seedClaudeAuth.js: the
// orchestrator injects credentials as env vars and this writes them where each CLI actually reads
// them. Idempotent + best-effort (a re-run overwrites with the same content; failures never crash
// boot — agent-launch.sh swallows throws), 0600 on every credential file, and a silent no-op when
// the env vars are absent (qwen/cursor are env-only and need no files at all).
const path = require("path")
const { mergeCodexMcp } = require("./codexMcpToml")
const { writeSecret, mergeJsonFile } = require("./secretFiles")
const { seedOpencodeConfig } = require("./seedOpencodeConfig")

const decode = (b64) => Buffer.from(String(b64), "base64").toString("utf8")

// Codex: `codex-acp`/`codex` read ~/.codex/auth.json (pasted subscription credential) and
// ~/.codex/config.toml (the oyren OpenRouter model_providers block the orchestrator renders, plus any
// OYREN_MCP_SERVERS merged in as streamable-HTTP [mcp_servers.*] so Codex discovers oyren-mcp with no
// manual setup — the codex-acp ACP bridge only forwards HTTP MCP when the CLI advertises the http
// capability, so seeding config.toml is the reliable Codex path regardless).
function seedCodex(home, env) {
  let wrote = false
  if (env.CODEX_AUTH_JSON_B64) { writeSecret(path.join(home, ".codex", "auth.json"), decode(env.CODEX_AUTH_JSON_B64)); wrote = true }
  const toml = mergeCodexMcp(env.CODEX_CONFIG_TOML_B64 ? decode(env.CODEX_CONFIG_TOML_B64) : "", env)
  if (toml.trim()) { writeSecret(path.join(home, ".codex", "config.toml"), toml); wrote = true }
  return wrote
}

// Gemini: subscription creds land in ~/.gemini/oauth_creds.json; settings.json must pin the auth type
// or the CLI re-prompts (and its ACP mode has ignored bare GEMINI_API_KEY — bugs #7549/#14893). Write
// both the legacy top-level key and the v2 security.auth path so any CLI version honors it.
function seedGemini(home, env) {
  let authType = null
  if (env.GEMINI_OAUTH_CREDS_B64) {
    writeSecret(path.join(home, ".gemini", "oauth_creds.json"), decode(env.GEMINI_OAUTH_CREDS_B64))
    authType = "oauth-personal"
  } else if (env.GEMINI_API_KEY) {
    authType = "gemini-api-key"
  }
  if (!authType) return false
  mergeJsonFile(path.join(home, ".gemini", "settings.json"), { selectedAuthType: authType, security: { auth: { selectedType: authType } } })
  return true
}

/** Seed every provider whose env vars are present; returns whether anything was written. */
function seedAgentAuth({ home = process.env.HOME || "/home/oyren", env = process.env } = {}) {
  const wroteCodex = seedCodex(home, env)
  const wroteGemini = seedGemini(home, env)
  // opencode's config is its own module — its schema is version-sensitive enough to warrant one.
  const wroteOpencode = seedOpencodeConfig(home, env)
  return wroteCodex || wroteGemini || wroteOpencode
}

module.exports = { seedAgentAuth }
