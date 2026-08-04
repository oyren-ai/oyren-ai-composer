// Seed the launch's composed agent context (AGENT_CONTEXT_B64, injected by the orchestrator from the
// selected oyren AI Agent's character/knowledge) into the provider-convention context file at the repo
// workdir — the file each CLI auto-reads every turn. The context lives inside a marker block so
// re-runs REPLACE it (idempotent) while any pre-existing repo-authored content is preserved untouched.
// Best-effort: a decode/write failure returns false and never crashes boot.
const fs = require("fs")
const path = require("path")

const BEGIN_MARK = "<!-- oyren:agent-context -->"
const END_MARK = "<!-- /oyren:agent-context -->"

const FILE_BY_KIND = {
  "claude-code": "CLAUDE.md",
  "gemini-cli": "GEMINI.md",
  "qwen-code": "QWEN.md",
}

/** Provider-convention context filename; codex/opencode/cursor/antigravity all read AGENTS.md. */
const contextFileFor = (kind) => FILE_BY_KIND[kind] || "AGENTS.md"

/** Remove a previous oyren marker block (markers included) so re-seeding replaces, never stacks. */
function stripMarkerBlock(text, beginMark = BEGIN_MARK, endMark = END_MARK) {
  const start = text.indexOf(beginMark)
  if (start < 0) return text
  const end = text.indexOf(endMark, start)
  if (end < 0) return text.slice(0, start) // unterminated block: drop from the marker on
  return text.slice(0, start) + text.slice(end + endMark.length)
}

/** Upsert `content` under the given markers in `file` (created when missing), preserving everything
 *  outside the block — shared with seedRuntimeGuidance, whose block coexists with this one. */
function seedMarkerBlock(file, content, beginMark, endMark) {
  let existing = ""
  try { existing = fs.readFileSync(file, "utf8") } catch { existing = "" } // no file yet → create it
  const base = stripMarkerBlock(existing, beginMark, endMark).replace(/\s+$/, "")
  const block = `${beginMark}\n${content}\n${endMark}\n`
  try { fs.writeFileSync(file, base ? `${base}\n\n${block}` : block) } catch { return false }
  return true
}

function seedAgentContext({ workdir = process.env.WORKING_DIR || "/workspace", env = process.env } = {}) {
  if (!env.AGENT_CONTEXT_B64) return false
  let context
  try { context = Buffer.from(env.AGENT_CONTEXT_B64, "base64").toString("utf8").trim() } catch { return false }
  if (!context) return false
  const file = path.join(workdir, contextFileFor(env.AGENT_KIND))
  return seedMarkerBlock(file, context, BEGIN_MARK, END_MARK)
}

module.exports = { seedAgentContext, contextFileFor, stripMarkerBlock, seedMarkerBlock }
