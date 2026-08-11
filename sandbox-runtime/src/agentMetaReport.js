// Invariant agent metadata, WRITE side (Phase 1b): collect the facts a relaunched container needs
// for deterministic recovery — per repo the current branch, its draft-PR URL (one `gh pr view` per
// branch, cached; absence tolerated) and the checkpoint ref name — plus the turn count (stored
// baseline + this boot's local turns), and POST the blob to the orchestrator (store form:
// {appSlug, controlToken, meta}) from the gitCheckpoint tick whenever it actually changed
// (deep-compare of the last sent blob, updatedAt excluded). Every failure is swallowed: meta must
// never affect checkpointing.
//
// The blob also carries this boot's auth verdict ({agentReady, agentReadyReason} — see
// agentAuthProbe.js), which is what makes a broken agent visible BEFORE anyone messages it. That is
// why an idle session now reports too, where it used to post nothing: an agent that can't
// authenticate has, by definition, no turns and no PR to show for itself. Recovery is unaffected —
// agentRecovery gates on turnCount > 0 or a concrete repo entry, not on the blob merely existing.
const path = require("path")
const { execFile } = require("child_process")
const { findGitRepoDirs, workdirFrom } = require("./workspaceRepo")
const { checkpointRef } = require("./checkpointRef")
const { loadStoredMeta, localTurnCount } = require("./agentMeta")
const { probeAgentAuth } = require("./agentAuthProbe")

const defaultRun = (cmd, args, opts) => new Promise((resolve) => {
  try { execFile(cmd, args, { maxBuffer: 1024 * 1024, ...opts }, (err, stdout) => resolve({ ok: !err, out: String(stdout || "").trim() })) }
  catch (e) { resolve({ ok: false, out: String((e && e.message) || e) }) }
})

const prUrls = new Map() // `${dir}#${branch}` → url; a hit is final, a miss retries next tick
let lastSent = null // JSON of the last successfully posted { repos, turnCount, agentReady, agentReadyReason }
let authVerdict // cached single-flight boot probe — the answer can't change without a relaunch

/** The boot auth verdict, probed at most once per container. Never throws. */
function loadAuthVerdict(opts) {
  if (!authVerdict) authVerdict = probeAgentAuth(opts).catch(() => null)
  return authVerdict
}

async function prUrlFor(dir, branch, run) {
  if (!branch) return null
  const key = `${dir}#${branch}`
  if (prUrls.has(key)) return prUrls.get(key)
  const got = await run("gh", ["pr", "view", "--json", "url", "-q", ".url"], { cwd: dir })
  if (got.ok && got.out) prUrls.set(key, got.out)
  return (got.ok && got.out) || null
}

/** The current meta blob: one entry per repo dir, the total turn count, and this boot's auth verdict. */
async function collectMeta({ env = process.env, run = defaultRun, fetchImpl, probe } = {}) {
  const stored = await loadStoredMeta({ env, fetchImpl })
  const repos = []
  for (const dir of findGitRepoDirs(workdirFrom(env))) {
    const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir })
    const name = branch.ok && branch.out ? branch.out : null
    repos.push({ dir: path.basename(dir), branch: name, prUrl: await prUrlFor(dir, name, run), checkpointRef: checkpointRef(env) })
  }
  const baseline = (stored && Number(stored.turnCount)) || 0
  const auth = probe ? await probe({ env }) : await loadAuthVerdict({ env })
  return {
    repos,
    turnCount: baseline + localTurnCount(),
    agentReady: auth ? auth.agentReady : undefined,
    agentReadyReason: auth ? auth.reason : undefined,
    updatedAt: new Date().toISOString(),
  }
}

/** Collect + POST when changed; returns a short outcome tag for the log. Never throws. */
async function reportMeta({ env = process.env, run = defaultRun, fetchImpl = globalThis.fetch, probe } = {}) {
  try {
    const meta = await collectMeta({ env, run, fetchImpl, probe })
    // Nothing to recover AND nothing to say about auth ⇒ keep the store empty (the old behaviour).
    // A known auth verdict is always worth sending: an agent that can't log in never produces a turn
    // or a PR, so withholding on "no work yet" is exactly how the failure stayed invisible.
    const knowsAuth = meta.agentReadyReason && meta.agentReadyReason !== "unknown"
    if (!meta.turnCount && !meta.repos.some((r) => r.prUrl) && !knowsAuth) return "idle"
    const key = JSON.stringify({
      repos: meta.repos,
      turnCount: meta.turnCount,
      agentReady: meta.agentReady,
      agentReadyReason: meta.agentReadyReason,
    })
    if (key === lastSent) return "unchanged"
    const { ORCHESTRATOR_URL, OYREN_SESSION_SLUG, CONTROL_TOKEN } = env
    if (!ORCHESTRATOR_URL || !OYREN_SESSION_SLUG || !CONTROL_TOKEN || !fetchImpl) return "no-endpoint"
    const res = await fetchImpl(`${ORCHESTRATOR_URL}/sandbox/agent-meta`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appSlug: OYREN_SESSION_SLUG, controlToken: CONTROL_TOKEN, meta }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return "post-failed" // lastSent untouched → retried next tick
    lastSent = key
    return "sent"
  } catch (e) { return `failed: ${String((e && e.message) || e)}` }
}

// Test seam: clear the PR cache, last-sent blob + cached auth verdict between cases.
function __reset() { prUrls.clear(); lastSent = null; authVerdict = undefined }

module.exports = { collectMeta, reportMeta, __reset }
