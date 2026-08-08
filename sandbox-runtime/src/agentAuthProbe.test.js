const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { probeAgentAuth, hasCredential, looksUnauthenticated } = require("./agentAuthProbe")

/** A HOME with (optionally) a seeded credential file for the given agent. */
function homeWith(relFile) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-auth-"))
  if (relFile) {
    fs.mkdirSync(path.join(home, path.dirname(relFile)), { recursive: true })
    fs.writeFileSync(path.join(home, relFile), '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-x"}}')
  }
  return home
}
const never = async () => assert.fail("probe should not have spawned anything")

test("no credentials file and no API key ⇒ auth_failed, with no process spawned", async () => {
  // THE incident: the orchestrator injected no CLAUDE_CODE_OAUTH_TOKEN because the launch named no
  // saved account, so seedClaudeAuth wrote nothing and every turn answered "Not logged in".
  const verdict = await probeAgentAuth({ home: homeWith(null), env: {}, agentKind: "claude-code", run: never })
  assert.deepEqual(verdict, { agentReady: false, reason: "auth_failed" })
})

test("a seeded credentials file with a passing probe ⇒ ok", async () => {
  const run = async () => ({ ok: true, out: "ok" })
  const verdict = await probeAgentAuth({
    home: homeWith(".claude/.credentials.json"),
    env: {},
    agentKind: "claude-code",
    run,
  })
  assert.deepEqual(verdict, { agentReady: true, reason: "ok" })
})

test("a seeded credential the API rejects (revoked/expired token) ⇒ auth_failed", async () => {
  const run = async () => ({ ok: false, out: "Not logged in · Please run /login" })
  const verdict = await probeAgentAuth({
    home: homeWith(".claude/.credentials.json"),
    env: {},
    agentKind: "claude-code",
    run,
  })
  assert.deepEqual(verdict, { agentReady: false, reason: "auth_failed" })
})

test("a probe that fails for an unrelated reason does NOT cry wolf", async () => {
  const run = async () => ({ ok: false, out: "network unreachable" })
  const verdict = await probeAgentAuth({
    home: homeWith(".claude/.credentials.json"),
    env: {},
    agentKind: "claude-code",
    run,
  })
  assert.equal(verdict.agentReady, true)
})

test("an API key in the env stands in for the credentials file", async () => {
  const run = async () => ({ ok: true, out: "" })
  const verdict = await probeAgentAuth({
    home: homeWith(null),
    env: { ANTHROPIC_API_KEY: "sk-x" },
    agentKind: "claude-code",
    run,
  })
  assert.equal(verdict.agentReady, true)
})

test("an unknown agent kind reports `unknown` rather than guessing", async () => {
  const verdict = await probeAgentAuth({ home: homeWith(null), env: {}, agentKind: "some-new-cli", run: never })
  assert.deepEqual(verdict, { agentReady: true, reason: "unknown" })
})

test("non-Claude agents are judged on their credential alone — no spawn", async () => {
  assert.deepEqual(await probeAgentAuth({ home: homeWith(null), env: {}, agentKind: "codex-cli", run: never }), {
    agentReady: false,
    reason: "auth_failed",
  })
  assert.deepEqual(
    await probeAgentAuth({ home: homeWith(null), env: { OPENAI_API_KEY: "k" }, agentKind: "opencode", run: never }),
    { agentReady: true, reason: "ok" },
  )
})

test("hasCredential treats an EMPTY credentials file as missing", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-auth-"))
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true })
  fs.writeFileSync(path.join(home, ".claude/.credentials.json"), "")
  assert.equal(hasCredential({ home, env: {}, agentKind: "claude-code" }), false)
})

test("looksUnauthenticated matches what the CLIs actually print", () => {
  assert.ok(looksUnauthenticated("Not logged in · Please run /login"))
  assert.ok(looksUnauthenticated('{"error":"authentication_failed"}'))
  assert.ok(!looksUnauthenticated("ECONNRESET while contacting the API"))
})
