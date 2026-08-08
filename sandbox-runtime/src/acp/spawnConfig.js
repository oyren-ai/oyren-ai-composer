// Per-AGENT_KIND spawn table for the ACP engine: which binary speaks ACP for each provider, and how to
// launch it. Every command lands on PATH via the per-agent image's global pnpm install (PNPM_HOME).
// `env(baseEnv)` lets a provider reshape its environment before spawn; the default passes it through
// untouched (auth is seeded as files/env by seedAgentAuth.js, not by flags here). cwd is the cloned
// repo workdir (WORKING_DIR, same var agent-launch.sh uses) so relative tool calls resolve in-repo.
const TABLE = {
  "codex-cli": { cmd: "codex-acp", args: [] },
  "gemini-cli": { cmd: "gemini", args: ["--experimental-acp"] },
  "qwen-code": { cmd: "qwen", args: ["--experimental-acp"] },
  "opencode": { cmd: "opencode", args: ["acp"] },
  // Official primary binary is `agent`; the install also ships a legacy `cursor-agent` symlink.
  // Prefer `agent` (matches Cursor ACP docs); the image symlinks both into /usr/local/bin.
  "cursor-cli": { cmd: "agent", args: ["acp"] },
  "antigravity-cli": { cmd: "antigravity-acp", args: [] },
}

/** The spawn recipe for an agent kind, or null when the kind has no ACP launcher (e.g. claude-code,
 *  which stays on the SDK engine — engineSelect never routes it here). */
function spawnConfigFor(kind, baseEnv = process.env) {
  const entry = TABLE[kind]
  if (!entry) return null
  return {
    cmd: entry.cmd,
    args: entry.args.slice(),
    cwd: baseEnv.WORKING_DIR || baseEnv.WORKDIR || "/workspace",
    env: entry.env ? entry.env({ ...baseEnv }) : { ...baseEnv },
  }
}

module.exports = { spawnConfigFor, TABLE }
