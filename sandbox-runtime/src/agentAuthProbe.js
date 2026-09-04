// Boot-time agent readiness: can the CLI this container runs actually authenticate?
//
// Why this exists: an agent whose credentials never arrived looks IDENTICAL to a healthy one from
// the outside — the container boots, App Platform reports it active, and the failure only surfaces
// as "Not logged in · Please run /login" on the first turn. Sessions nobody messages never surface
// it at all; four of them once sat "running" all night and expired without a single turn. So we ask
// at boot, before anyone types, and report the verdict to the orchestrator (agentMetaReport.js).
//
// Deliberately cheap and fail-SOFT in one direction only: an unknown agent kind, or a probe we
// can't run, reports `unknown` rather than a false alarm — but a missing credential file (the
// actual failure mode) is reported as `auth_failed` with no network call at all.
const fs = require("fs")
const path = require("path")
const { execFile } = require("child_process")

const PROBE_TIMEOUT_MS = 25000

/**
 * Per-agent credential expectations. `file` is relative to $HOME; `env` names env vars that make the
 * file unnecessary (an API key the CLI reads directly). An agent absent from this table is `unknown`
 * — we never guess, because a wrong "failed" is worse than no signal.
 */
const CREDENTIALS = {
  "claude-code": { file: ".claude/.credentials.json", env: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] },
  // The *_B64 seed vars count too: the side-auth overlay (sideAgentAuth.js) carries file-shaped
  // creds as env, and seedAgentAuth.js only writes the file when that kind first spawns — a
  // credential that WILL be seeded is a credential the caller has.
  "codex-cli": { file: ".codex/auth.json", env: ["OPENAI_API_KEY", "CODEX_AUTH_JSON_B64"] },
  "gemini-cli": { file: ".gemini/oauth_creds.json", env: ["GEMINI_API_KEY", "GEMINI_OAUTH_CREDS_B64"] },
  "qwen-code": { file: null, env: ["OPENAI_API_KEY", "DASHSCOPE_API_KEY"] },
  // Keyed by AGENT_KIND — the spawn-table name is "cursor-cli"; the old "cursor" key never matched,
  // so cursor launches silently probed as `unknown` instead of catching a missing CURSOR_API_KEY.
  "cursor-cli": { file: null, env: ["CURSOR_API_KEY"] },
  opencode: { file: null, env: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"] },
  // antigravity-cli is deliberately absent: no credential contract is seeded or documented for it
  // anywhere in this runtime, and a wrong "failed" is worse than an honest `unknown`.
}

const defaultRun = (cmd, args, opts) =>
  new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: 512 * 1024, ...opts }, (err, stdout, stderr) =>
        resolve({ ok: !err, out: `${stdout || ""}${stderr || ""}` }),
      )
    } catch (e) {
      resolve({ ok: false, out: String((e && e.message) || e) })
    }
  })

/** Text the CLIs emit when they are running but unauthenticated. */
const looksUnauthenticated = (text) =>
  /not logged in|please run \/login|authentication_failed|unauthorized|invalid api key|401/i.test(text)

/**
 * Does this container hold a credential the agent can use at all? Pure file/env inspection — no
 * process spawn, no network. This is the check that catches the real incident.
 */
function hasCredential({ home = process.env.HOME || "/home/oyren", env = process.env, agentKind } = {}) {
  const spec = CREDENTIALS[agentKind]
  if (!spec) return null // unknown agent — no opinion
  if (spec.env.some((name) => !!env[name])) return true
  if (!spec.file) return false
  try {
    return fs.statSync(path.join(home, spec.file)).size > 0
  } catch {
    return false
  }
}

/**
 * The boot verdict: `{ agentReady, reason }` with reason one of
 * `ok` | `auth_failed` | `unknown`. Never throws.
 *
 * `probe` (a one-shot headless call) is only consulted when a credential IS present, so the common
 * failure costs nothing; it exists to catch a credential that is present but rejected (revoked or
 * expired token). A probe that fails for any OTHER reason leaves the verdict at ready — we would
 * rather miss a failure than cry wolf about a working agent.
 */
async function probeAgentAuth({ home, env = process.env, agentKind = env.AGENT_KIND || "", run = defaultRun } = {}) {
  try {
    const credential = hasCredential({ home, env, agentKind })
    if (credential === null) return { agentReady: true, reason: "unknown" }
    if (!credential) return { agentReady: false, reason: "auth_failed" }
    if (agentKind !== "claude-code") return { agentReady: true, reason: "ok" }
    // Claude Code is the only agent with a cheap, reliable headless one-shot.
    const got = await run("claude", ["-p", "ok", "--max-turns", "1"], { cwd: env.WORKDIR || "/workspace" })
    if (!got.ok && looksUnauthenticated(got.out)) return { agentReady: false, reason: "auth_failed" }
    return { agentReady: true, reason: "ok" }
  } catch {
    return { agentReady: true, reason: "unknown" }
  }
}

module.exports = { probeAgentAuth, hasCredential, looksUnauthenticated, CREDENTIALS }
