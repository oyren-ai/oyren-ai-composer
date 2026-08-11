// Session continuity for the ACP engine (the non-Claude providers) — the mirror of agentSession.js's
// ~/.oyren-agent-session for the SDK engine. sessionStart.js persists every live ACP sessionId here
// and offers it to `session/load` on the next start when the agent advertises the loadSession
// capability (gemini/qwen/opencode), resuming the SAME conversation after an agent-child or node-only
// crash; providers without it (codex) fall through to session/new. Container-lifetime only (no DB):
// $HOME is ephemeral, so a full container replacement clears it — that path is covered by the GitHub
// recovery preamble (agentRecovery.js) instead.
const fs = require("fs")
const path = require("path")

function sessionFile(home = process.env.HOME || "/home/oyren") {
  return path.join(home, ".oyren-acp-session")
}

function readSessionId(home) {
  try {
    return fs.readFileSync(sessionFile(home), "utf8").trim() || null
  } catch {
    return null // no prior session yet (or unreadable) → start a fresh one
  }
}

function writeSessionId(id, home) {
  try {
    fs.writeFileSync(sessionFile(home), String(id))
  } catch {
    /* best-effort: a lost id just means the next start is session/new, never a crash */
  }
}

module.exports = { readSessionId, writeSessionId, sessionFile }
