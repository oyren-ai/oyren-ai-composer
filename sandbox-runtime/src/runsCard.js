// Renders ONE detached-run card for the /_oyren/runs.html panel (see runsPage.js). Split out of
// runsPage.js so each file stays small: this owns the per-run markup (command, status badge, timing,
// stdout/stderr tails); runsPage.js owns the page shell + polling. Data is a `jobs.list()` entry.
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))

/** HH:MM:SS of an epoch-ms instant (UTC, matching the logs page), or "—" when unset. */
function formatTime(ms) {
  return ms ? new Date(ms).toISOString().slice(11, 19) : "—"
}

/** Human-readable elapsed time between two epoch-ms instants (up to `now` while still running). */
function formatDuration(startedAt, finishedAt, now = Date.now) {
  const end = finishedAt == null ? now() : finishedAt
  const secs = Math.max(0, (end - startedAt) / 1000)
  return secs < 60 ? secs.toFixed(1) + "s" : Math.floor(secs / 60) + "m " + Math.round(secs % 60) + "s"
}

/** Status pill: running (amber), timed out (red), exit 0 (green), or exit N (red). */
function statusBadge(run) {
  if (run.status === "running") return `<span class="badge running">● running</span>`
  if (run.timedOut) return `<span class="badge fail">timed out</span>`
  const ok = run.exitCode === 0
  return `<span class="badge ${ok ? "ok" : "fail"}">exit ${run.exitCode == null ? "?" : run.exitCode}</span>`
}

/** One <section class="run"> card. stdout/stderr are the (possibly truncated) tails from list(). */
function renderCard(run) {
  const out = String(run.stdout || "")
  const err = String(run.stderr || "")
  const trunc = run.truncated
    ? `<p class="trunc">output truncated — GET /_oyren/runs?runId=${escapeHtml(run.runId)} for the full text</p>`
    : ""
  const errBlock = err ? `<pre class="stderr">${escapeHtml(err)}</pre>` : ""
  const outBlock = out ? `<pre>${escapeHtml(out)}</pre>` : `<pre class="empty">(no stdout)</pre>`
  return `<section class="run">
    <div class="head">
      <code class="cmd">${escapeHtml(run.command || "(no command)")}</code>
      ${statusBadge(run)}
    </div>
    <div class="meta">started ${formatTime(run.startedAt)} · ${escapeHtml(formatDuration(run.startedAt, run.finishedAt))}</div>
    ${outBlock}${errBlock}${trunc}
  </section>`
}

module.exports = { renderCard, statusBadge, formatTime, formatDuration, escapeHtml }
