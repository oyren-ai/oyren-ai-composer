// Built from scratch, explicit allowlist — NOT a blocklist. sessionEnv()/mergedEnv() (sessionEnv.mjs)
// hand the extension host's own process the full CONTAINER_ENV_B64 blob: every session secret,
// including ones a wrapped `claude` child has no business seeing (GITHUB_TOKEN, CONTROL_TOKEN,
// SESSION_TOKEN, OYREN_MCP_SERVERS, AGENT_SIDE_AUTH_B64 — auth for OTHER surfaces, not this child's
// own credentials). A blocklist would silently start leaking the next secret someone adds to the
// session env; only what's named here ever reaches the child.
const ALLOWED_KEYS = new Set([
  // Claude's own credentials — the BYOK path (ANTHROPIC_BASE_URL/API_KEY/AUTH_TOKEN) has no
  // credentials-file fallback inside a wrapped child, so forwarding these is load-bearing there.
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "IS_SANDBOX",
  // Process mechanics — needed to exec and behave like a normal interactive shell child, not secrets.
  "HOME",
  "PATH",
  "TERM",
  "LANG",
  "LC_ALL",
  "SHELL",
  "USER",
  "PWD",
])

/** Filter a source env down to ALLOWED_KEYS only. Unknown/sensitive keys (GITHUB_TOKEN, CONTROL_TOKEN,
 *  SESSION_TOKEN, OYREN_MCP_SERVERS, AGENT_SIDE_AUTH_B64, or anything not explicitly named above) are
 *  dropped, not passed through. */
function filterEnv(sourceEnv) {
  const out = {}
  for (const key of ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(sourceEnv, key)) out[key] = sourceEnv[key]
  }
  return out
}

module.exports = { filterEnv, ALLOWED_KEYS }
