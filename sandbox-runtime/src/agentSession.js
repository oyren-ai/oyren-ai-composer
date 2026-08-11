// Session continuity for the headless agent chat. Each POST /agent/message runs ONE `claude -p` turn
// and exits; passing `--resume <id>` on the next turn is what continues the SAME conversation — including
// after a browser reload, since the long-lived container still holds it. claude stores the actual
// transcript under ~/.claude/projects/<cwd>/<id>.jsonl keyed by cwd, so the server always spawns with the
// same cwd (WORKDIR) and only needs to remember the id here. Container-lifetime only (no DB).
const fs = require("fs")
const path = require("path")

function sessionFile(home = process.env.HOME || "/home/oyren") {
  return path.join(home, ".oyren-agent-session")
}

function readSessionId(home) {
  try {
    return fs.readFileSync(sessionFile(home), "utf8").trim() || null
  } catch {
    return null // no prior turn yet (or unreadable) → start a fresh session
  }
}

function writeSessionId(id, home) {
  try {
    fs.writeFileSync(sessionFile(home), String(id))
  } catch {
    /* best-effort: a lost id just means the next turn starts fresh, never a crash */
  }
}

// The session_id rides on the `system` event at the start of every turn (same value across resumes), so
// capturing it idempotently keeps the stored id correct. Returns null for non-system / partial lines.
function extractSessionId(line) {
  try {
    const j = JSON.parse(line)
    if (j && j.type === "system" && typeof j.session_id === "string") return j.session_id
  } catch {
    /* partial or non-JSON line — ignore */
  }
  return null
}

// One-shot headless invocation: the prompt is an ARG (not streamed stdin), so claude runs exactly one
// turn and exits — the right fit for "one HTTP request = one turn". `--resume` continues a prior session.
// `--model` lets the orchestrator pick which model answers (AGENT_MODEL: a subscription alias like
// `sonnet`/`opus`, or a gateway model id on the ANTHROPIC_BASE_URL path); empty ⇒ the CLI's own default.
function buildArgs(text, sessionId, model = process.env.AGENT_MODEL) {
  const args = ["-p", text, "--output-format", "stream-json", "--include-partial-messages", "--verbose"]
  if (model) args.push("--model", model)
  if (sessionId) args.push("--resume", sessionId)
  return args
}

module.exports = { readSessionId, writeSessionId, extractSessionId, buildArgs, sessionFile }
