const fs = require("fs")
const path = require("path")

// Ids we ship ourselves (see seedClaudeSkills.js) — never let a user-selected skill clobber these,
// even if it happens to share the same id/slug.
const RESERVED_IDS = new Set(["finding-skills", "proxy-routes"])

/** Slugify a skill id into a safe directory name (defends against path traversal / weird chars too). */
function slugify(id) {
  return String(id || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")
}

/** Quote a YAML scalar value safely (escape backslashes/quotes, collapse newlines). */
function yamlQuote(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`
}

/**
 * When AGENT_SKILLS_B64 (base64 JSON array of {id,name,description,body}, injected by the orchestrator
 * from the user's launch-time Skill selection / settings defaults) is present, write each into
 * ~/.claude/skills/<id>/SKILL.md so Claude Code discovers it alongside the bundled skills (see
 * seedClaudeSkills.js). Purely additive: only ever touches the ids it's given, never the bundled
 * finding-skills/proxy-routes dirs. Idempotent + best-effort — a decode/parse/write failure must never
 * crash boot (the caller swallows throws). Returns the count seeded.
 */
function seedUserSkills({ home = process.env.HOME || "/home/oyren", env = process.env } = {}) {
  const raw = env.AGENT_SKILLS_B64
  if (!raw) return 0
  let decoded
  try {
    decoded = Buffer.from(raw, "base64").toString("utf8")
  } catch {
    return 0
  }
  let skills
  try {
    skills = JSON.parse(decoded)
  } catch {
    return 0
  }
  if (!Array.isArray(skills) || skills.length === 0) return 0

  const dest = path.join(home, ".claude", "skills")
  let added = 0
  for (const s of skills) {
    if (!s || typeof s.id !== "string" || typeof s.body !== "string" || !s.body.trim()) continue
    const id = slugify(s.id)
    if (!id || RESERVED_IDS.has(id)) continue
    const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : id
    const description = typeof s.description === "string" ? s.description.trim() : ""
    const frontmatter = `---\nname: ${yamlQuote(name)}\ndescription: ${yamlQuote(description)}\n---\n\n`
    const content = frontmatter + s.body.trim() + "\n"
    try {
      fs.mkdirSync(path.join(dest, id), { recursive: true })
      fs.writeFileSync(path.join(dest, id, "SKILL.md"), content)
      added++
    } catch {
      /* best-effort per skill: one bad write must never crash boot */
    }
  }
  return added
}

module.exports = { seedUserSkills, slugify }
