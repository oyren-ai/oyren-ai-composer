const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { seedRuntimeGuidance, guidanceText } = require("./seedRuntimeGuidance")
const { seedAgentContext } = require("./seedAgentContext")

const repoDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-guide-")); fs.mkdirSync(path.join(dir, ".git")); return dir }
const env = (extra = {}) => ({ AGENT_KIND: "codex-cli", OYREN_SESSION_SLUG: "sl-1", OYREN_SESSION_UUID: "uu-1", ...extra })

test("seeds the workflow block into the provider context file, under its OWN marker", () => {
  const workdir = repoDir()
  assert.equal(seedRuntimeGuidance({ workdir, env: env() }), true)
  const text = fs.readFileSync(path.join(workdir, "AGENTS.md"), "utf8")
  assert.match(text, /<!-- oyren:runtime-guidance -->/)
  assert.match(text, /<!-- \/oyren:runtime-guidance -->/)
  assert.match(text, /gh pr create --draft/) // PR-first journal
  assert.match(text, /!\[description\]\(url\)/) // embed pasted images inline in the PR body
  assert.match(text, /Co-Authored-By: Oyren Agent <contact@oyren\.ai>/) // commit attribution
  assert.match(text, /run them locally in this container — do not offload them/) // heavy commands stay local
  assert.match(text, /MemAvailable/) // check free memory first
  assert.match(text, /max-old-space-size/) // cap the process below what's free
  assert.match(text, /`oyren\/checkpoint-sl-1`/) // the ACTUAL checkpoint ref name
  assert.match(text, /`oyren route add <prefix> <port>/) // how to expose an app via the gateway
  assert.match(text, /_oyren\/port\/<SESSION_TOKEN>\/<port>\//) // the token-gated port proxy alternative
  assert.match(text, /localhost in THEIR browser is THEIR machine/) // why localhost URLs never work for the user
  assert.match(text, /`\/_oyren\/gateway`/) // where to see route status
  assert.match(text, /`\/_oyren\/logs`/) // where to debug a route that won't come up
  assert.ok(!text.includes("run_script")) // no more script-runner offload
})

test("every agent kind gets it — claude-code lands in CLAUDE.md", () => {
  const workdir = repoDir()
  seedRuntimeGuidance({ workdir, env: env({ AGENT_KIND: "claude-code" }) })
  assert.ok(fs.existsSync(path.join(workdir, "CLAUDE.md")))
})

test("re-running REPLACES the block instead of stacking a second one", () => {
  const workdir = repoDir()
  seedRuntimeGuidance({ workdir, env: env() })
  seedRuntimeGuidance({ workdir, env: env({ OYREN_SESSION_SLUG: "sl-2" }) })
  const text = fs.readFileSync(path.join(workdir, "AGENTS.md"), "utf8")
  assert.equal((text.match(/<!-- oyren:runtime-guidance -->/g) || []).length, 1)
  assert.match(text, /checkpoint-sl-2/)
  assert.ok(!text.includes("checkpoint-sl-1"))
})

test("coexists with the agent-context block — seeding one never clobbers the other", () => {
  const workdir = repoDir()
  fs.writeFileSync(path.join(workdir, "AGENTS.md"), "# Repo rules\n")
  seedAgentContext({ workdir, env: { AGENT_KIND: "codex-cli", AGENT_CONTEXT_B64: Buffer.from("Persona.").toString("base64") } })
  seedRuntimeGuidance({ workdir, env: env() })
  seedAgentContext({ workdir, env: { AGENT_KIND: "codex-cli", AGENT_CONTEXT_B64: Buffer.from("Persona v2.").toString("base64") } })
  const text = fs.readFileSync(path.join(workdir, "AGENTS.md"), "utf8")
  assert.ok(text.startsWith("# Repo rules")) // repo-authored content preserved
  assert.match(text, /Persona v2\./)
  assert.ok(!text.includes("Persona.\n<!--")) // old context replaced…
  assert.match(text, /oyren:runtime-guidance/) // …while the guidance block survived
})

test("a repo-less workdir is a no-op (no context file created)", () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-guide-norepo-"))
  assert.equal(seedRuntimeGuidance({ workdir, env: env() }), false)
  assert.deepEqual(fs.readdirSync(workdir), [])
})
