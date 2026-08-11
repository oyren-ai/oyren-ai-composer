const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { seedUserSkills, slugify } = require("./seedUserSkills")

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-user-skills-home-"))
const b64 = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64")

test("writes each skill into ~/.claude/skills/<id>/SKILL.md with a frontmatter block", () => {
  const home = tmpHome()
  const added = seedUserSkills({
    home,
    env: {
      AGENT_SKILLS_B64: b64([
        { id: "beautiful-web-design", name: "Beautiful web design", description: "Design taste checklist", body: "# Body\n\ncontent here" },
      ]),
    },
  })
  assert.equal(added, 1)
  const seeded = fs.readFileSync(path.join(home, ".claude", "skills", "beautiful-web-design", "SKILL.md"), "utf8")
  assert.match(seeded, /^---\nname: "Beautiful web design"\ndescription: "Design taste checklist"\n---\n\n# Body/)
})

test("does nothing (no dir created) when AGENT_SKILLS_B64 is absent or empty", () => {
  const a = tmpHome()
  assert.equal(seedUserSkills({ home: a, env: {} }), 0)
  assert.equal(fs.existsSync(path.join(a, ".claude", "skills")), false)
  const b = tmpHome()
  assert.equal(seedUserSkills({ home: b, env: { AGENT_SKILLS_B64: b64([]) } }), 0)
})

test("returns 0 on malformed base64/JSON or all-invalid entries, never throwing", () => {
  const a = tmpHome()
  assert.equal(seedUserSkills({ home: a, env: { AGENT_SKILLS_B64: "not-valid-base64-json!!" } }), 0)
  const b = tmpHome()
  assert.equal(seedUserSkills({ home: b, env: { AGENT_SKILLS_B64: b64([{ id: "x" }]) } }), 0) // missing body
  const c = tmpHome()
  assert.equal(seedUserSkills({ home: c, env: { AGENT_SKILLS_B64: b64([{ body: "no id" }]) } }), 0) // missing id
})

test("never clobbers the bundled finding-skills/proxy-routes ids", () => {
  const home = tmpHome()
  fs.mkdirSync(path.join(home, ".claude", "skills", "finding-skills"), { recursive: true })
  fs.writeFileSync(path.join(home, ".claude", "skills", "finding-skills", "SKILL.md"), "ORIGINAL")
  const added = seedUserSkills({
    home,
    env: { AGENT_SKILLS_B64: b64([{ id: "finding-skills", name: "x", description: "y", body: "HIJACKED" }]) },
  })
  assert.equal(added, 0)
  const content = fs.readFileSync(path.join(home, ".claude", "skills", "finding-skills", "SKILL.md"), "utf8")
  assert.equal(content, "ORIGINAL")
})

test("is additive alongside other skills and idempotent on re-run", () => {
  const home = tmpHome()
  fs.mkdirSync(path.join(home, ".claude", "skills", "proxy-routes"), { recursive: true })
  fs.writeFileSync(path.join(home, ".claude", "skills", "proxy-routes", "SKILL.md"), "bundled")
  const env = { AGENT_SKILLS_B64: b64([{ id: "threejs", name: "Three.js", description: "3D", body: "scene setup" }]) }
  seedUserSkills({ home, env })
  seedUserSkills({ home, env }) // re-run should not throw or duplicate
  assert.deepEqual(fs.readdirSync(path.join(home, ".claude", "skills")).sort(), ["proxy-routes", "threejs"])
})

test("slugify sanitizes ids into safe directory names", () => {
  assert.equal(slugify("Beautiful Web Design!"), "beautiful-web-design")
  assert.equal(slugify("../../etc/passwd"), "etc-passwd")
  assert.equal(slugify(""), "")
})
