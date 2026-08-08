const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { seedClaudeSkills } = require("./seedClaudeSkills")

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p))

// Build a fake bundled-skills dir with one real skill (dir + SKILL.md), one dir WITHOUT SKILL.md,
// and one stray file — only the real skill should be seeded.
function fakeSrc() {
  const src = tmp("oyren-skills-src-")
  fs.mkdirSync(path.join(src, "finding-skills"), { recursive: true })
  fs.writeFileSync(path.join(src, "finding-skills", "SKILL.md"), "---\nname: finding-skills\n---\nbody")
  fs.writeFileSync(path.join(src, "finding-skills", "helper.sh"), "echo hi") // supporting file
  fs.mkdirSync(path.join(src, "not-a-skill"), { recursive: true }) // dir with no SKILL.md
  fs.writeFileSync(path.join(src, "loose.txt"), "ignore me") // stray file
  return src
}

test("seeds each bundled skill (dir + SKILL.md) into ~/.claude/skills, recursively", () => {
  const home = tmp("oyren-skills-home-")
  const added = seedClaudeSkills({ home, srcDir: fakeSrc() })
  assert.equal(added, 1)
  const dest = path.join(home, ".claude", "skills", "finding-skills")
  assert.equal(fs.existsSync(path.join(dest, "SKILL.md")), true)
  assert.equal(fs.existsSync(path.join(dest, "helper.sh")), true) // supporting files copied too
})

test("skips dirs without SKILL.md and stray files", () => {
  const home = tmp("oyren-skills-home-")
  seedClaudeSkills({ home, srcDir: fakeSrc() })
  const skillsDir = path.join(home, ".claude", "skills")
  assert.deepEqual(fs.readdirSync(skillsDir), ["finding-skills"])
})

test("returns 0 without throwing when the bundled dir is absent", () => {
  const home = tmp("oyren-skills-home-")
  assert.equal(seedClaudeSkills({ home, srcDir: path.join(home, "nope") }), 0)
})

test("overwrites our own skill dir so an image update replaces a stale copy", () => {
  const home = tmp("oyren-skills-home-")
  const src = fakeSrc()
  seedClaudeSkills({ home, srcDir: src })
  fs.writeFileSync(path.join(src, "finding-skills", "SKILL.md"), "---\nname: finding-skills\n---\nNEW")
  seedClaudeSkills({ home, srcDir: src })
  const seeded = fs.readFileSync(path.join(home, ".claude", "skills", "finding-skills", "SKILL.md"), "utf8")
  assert.match(seeded, /NEW/)
})
