const fs = require("fs")
const path = require("path")

// Skills we bundle in the image (COPYed to /app/skills). At launch we copy each into the running user's
// ~/.claude/skills/<name>/ so Claude Code discovers it from its PERSONAL skills dir — which works for both
// the interactive `claude` and the headless `claude -p` chat (skills auto-load from ~/.claude/skills in
// both modes, matched by their `description`). Seeded at launch (not COPYed straight to $HOME in the
// Dockerfile) so it lands under the real HOME owned by the runtime user, same as the other seed scripts.
const BUNDLED_SKILLS_DIR = path.join(__dirname, "..", "skills")

/**
 * Copy every bundled skill (a subdirectory containing SKILL.md) into ~/.claude/skills. Overwrites our own
 * skill dirs so an image update replaces stale copies, but only touches the dirs we ship — never a skill
 * the user added under a different name. Idempotent + best-effort: a missing source dir or a failed copy
 * must never crash container boot (the caller swallows throws). Returns the count seeded.
 */
function seedClaudeSkills({ home = process.env.HOME || "/home/oyren", srcDir = BUNDLED_SKILLS_DIR } = {}) {
  let entries
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true })
  } catch {
    return 0 // no bundled skills dir (e.g. an image built without it) → nothing to seed
  }
  const dest = path.join(home, ".claude", "skills")
  let added = 0
  for (const e of entries) {
    // A skill is a directory containing SKILL.md; skip stray files and empty dirs.
    if (!e.isDirectory() || !fs.existsSync(path.join(srcDir, e.name, "SKILL.md"))) continue
    try {
      fs.mkdirSync(dest, { recursive: true })
      fs.cpSync(path.join(srcDir, e.name), path.join(dest, e.name), { recursive: true })
      added++
    } catch {
      /* best-effort per skill: one bad copy must never crash boot */
    }
  }
  return added
}

module.exports = { seedClaudeSkills }
