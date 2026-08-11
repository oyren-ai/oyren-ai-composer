const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { seedAgentContext, contextFileFor } = require("./seedAgentContext")

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-agent-ctx-"))
const b64 = (s) => Buffer.from(s, "utf8").toString("base64")

test("picks the provider-convention context file per agent kind", () => {
  assert.equal(contextFileFor("claude-code"), "CLAUDE.md")
  assert.equal(contextFileFor("gemini-cli"), "GEMINI.md")
  assert.equal(contextFileFor("qwen-code"), "QWEN.md")
  for (const kind of ["codex-cli", "opencode", "cursor-cli", "antigravity-cli", undefined]) {
    assert.equal(contextFileFor(kind), "AGENTS.md", String(kind))
  }
})

test("does nothing without AGENT_CONTEXT_B64", () => {
  const workdir = tmpDir()
  assert.equal(seedAgentContext({ workdir, env: {} }), false)
  assert.deepEqual(fs.readdirSync(workdir), [])
})

test("creates the context file under begin/end markers when the repo has none", () => {
  const workdir = tmpDir()
  assert.equal(seedAgentContext({ workdir, env: { AGENT_KIND: "codex-cli", AGENT_CONTEXT_B64: b64("You are the docs agent.") } }), true)
  const text = fs.readFileSync(path.join(workdir, "AGENTS.md"), "utf8")
  assert.match(text, /^<!-- oyren:agent-context -->\nYou are the docs agent\.\n<!-- \/oyren:agent-context -->\n$/)
})

test("appends below existing repo content without touching it", () => {
  const workdir = tmpDir()
  fs.writeFileSync(path.join(workdir, "GEMINI.md"), "# Repo rules\n\nUse pnpm.\n")
  seedAgentContext({ workdir, env: { AGENT_KIND: "gemini-cli", AGENT_CONTEXT_B64: b64("Agent persona.") } })
  const text = fs.readFileSync(path.join(workdir, "GEMINI.md"), "utf8")
  assert.ok(text.startsWith("# Repo rules\n\nUse pnpm.")) // repo-authored content preserved verbatim
  assert.match(text, /<!-- oyren:agent-context -->\nAgent persona\.\n<!-- \/oyren:agent-context -->/)
})

test("re-running REPLACES the marker block instead of stacking a second one", () => {
  const workdir = tmpDir()
  fs.writeFileSync(path.join(workdir, "QWEN.md"), "repo stuff\n")
  const env = (ctx) => ({ AGENT_KIND: "qwen-code", AGENT_CONTEXT_B64: b64(ctx) })
  seedAgentContext({ workdir, env: env("old context") })
  seedAgentContext({ workdir, env: env("new context") })
  const text = fs.readFileSync(path.join(workdir, "QWEN.md"), "utf8")
  assert.equal((text.match(/<!-- oyren:agent-context -->/g) || []).length, 1)
  assert.ok(text.includes("new context"))
  assert.ok(!text.includes("old context"))
  assert.ok(text.startsWith("repo stuff"))
})

test("empty decoded context is a no-op (no file created)", () => {
  const workdir = tmpDir()
  assert.equal(seedAgentContext({ workdir, env: { AGENT_KIND: "codex-cli", AGENT_CONTEXT_B64: b64("   ") } }), false)
  assert.equal(fs.existsSync(path.join(workdir, "AGENTS.md")), false)
})
