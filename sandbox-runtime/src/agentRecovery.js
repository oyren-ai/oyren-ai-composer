// Blank-boot recovery preamble (the last continuity layer): when the container was REPLACED (OOM /
// DO recycle) the ephemeral $HOME + /workspace are wiped and the conversation is unrecoverable
// locally — but the durable truth lives on GitHub (draft-PR plan + step commits + the auto-checkpoint
// shadow ref) and the orchestrator remembers the invariants (agentMeta.js). The preamble fires ONLY
// when stored meta proves there WAS prior work (turnCount > 0, or a repo entry carrying a branch /
// PR / checkpoint ref) — no meta means a brand-new session, which must never be told it "was
// restarted". With concrete repo entries it states the actual branch / PR URL / checkpoint ref;
// with only a turn count it stays honest and generic. Fires at most once per boot; engines call it
// AFTER startup succeeded and dispatch the prompt immediately, so the latch never burns on a failed
// start. Agent-facing only (applied after the user-message echo — the UI/log never shows it).
const { loadStoredMeta } = require("./agentMeta")

let fired = false // once per boot: a second turn already has the recovered context in-session

const concreteRepos = (meta) => (Array.isArray(meta && meta.repos) ? meta.repos : []).filter((r) => r && (r.branch || r.prUrl || r.checkpointRef))

function repoLine(r) {
  const parts = []
  if (r.branch) parts.push(`your working branch is \`${r.branch}\``)
  if (r.prUrl) parts.push(`your draft PR is ${r.prUrl} — its body is your plan/checklist`)
  if (r.checkpointRef) parts.push(`checkpoint ref \`${r.checkpointRef}\` may hold newer edits (fetch it; restore/cherry-pick anything newer than your branch)`)
  return `- ${r.dir ? `In \`${r.dir}\`: ` : ""}${parts.join("; ")}.`
}

function recoveryPreamble(meta) {
  const head = "[CONTEXT RECOVERY] This container was restarted and your prior conversation was lost."
  const repos = concreteRepos(meta)
  if (!repos.length) return [
    head,
    "Check git/GitHub for pushed work (`git log --oneline -30`, `gh pr list`) before answering; if nothing is found, ask the user to restate the task.",
    "Do not pretend to remember the previous conversation.",
  ].join("\n")
  return [
    `${head} Your durable state is on GitHub:`,
    ...repos.map(repoLine),
    "Run `git log --oneline -30` and `gh pr view --json title,body` to reload the history and checklist, then continue from the next unchecked step.",
    "Do not re-introduce yourself or redo completed work.",
  ].join("\n")
}

/** Prepend the recovery preamble to `payload` (string or content-block array, mirroring
 *  withBusyTurnReminder) at most once per boot. `hasLocalSession` = this boot genuinely resumed the
 *  prior conversation (--resume / a real session/load) — pass through untouched. */
async function maybeRecover(payload, { hasLocalSession = false, env = process.env, fetchImpl } = {}) {
  if (fired || hasLocalSession) return payload
  const meta = await loadStoredMeta({ env, fetchImpl })
  // Re-check the latch AFTER the await: two concurrent first sends both pass the check above, but
  // only the first continuation to resume may latch + prepend — the other must pass through untouched.
  if (fired || !meta || !((Number(meta.turnCount) || 0) > 0 || concreteRepos(meta).length > 0)) return payload
  fired = true
  const text = recoveryPreamble(meta)
  if (Array.isArray(payload)) return [{ type: "text", text }, ...payload]
  return `${text}\n\n${String(payload)}`
}

/** An engine dropped a prompt AFTER maybeRecover (the child exited during the meta await): when THIS
 *  call had prepended the preamble (`recovered !== payload` — untouched passes return the payload
 *  as-is), restore the latch so the retry send still recovers; returns the error the engine surfaces. */
function promptDropped(payload, recovered) {
  if (recovered !== payload) fired = false
  return new Error("agent process exited before the prompt was dispatched")
}

// Test seam: clear the once-per-boot latch between cases (pair with agentMeta.__reset()).
function __reset() { fired = false }

module.exports = { maybeRecover, recoveryPreamble, promptDropped, __reset }
