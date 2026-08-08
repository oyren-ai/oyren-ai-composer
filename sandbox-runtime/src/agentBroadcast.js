// The session's live output fan-out + a rolling replay buffer. Every SDK message the engine produces is
// recorded here as one ndjson line, fanned out to all currently-attached readers (GET /agent/stream), and
// kept in a byte-capped tail so a reader that connects (or reconnects after a drop) replays recent context
// — typically the in-flight turn — before tailing live. Unlike the old per-turn log this is continuous for
// the container's life; the cap (oldest lines dropped) keeps memory bounded during hours-long sessions.
// Each line carries a monotonic index `n` (never reused, even across reset()) and the process exposes a
// BOOT_ID, so a cursor-aware reader (the orchestrator's pull pump) can reconnect with `after=<n>` and
// replay only what it hasn't seen — instead of re-ingesting the whole buffer on every tunnel blip.
const crypto = require("crypto")

const BUFFER_MAX_BYTES = Number(process.env.AGENT_BUFFER_MAX_BYTES) || 16 * 1024 * 1024
const BOOT_ID = crypto.randomUUID() // fresh per process start; a cursor from another boot is meaningless

let entries = [] // { n, line } — recent ndjson lines (no trailing newline), oldest first
let byteSize = 0
let nextN = 1 // monotonic for the process life; reset() does NOT rewind it, so cursors never go backwards
const readers = new Set() // { onLine(line, n) } — live attachers tailing the session

/** Record one complete ndjson line: append to the rolling tail (dropping oldest past the cap) then fan
 *  out to live readers. Fan-out is synchronous and AFTER the append, so a reader that snapshots the tail
 *  and then subscribes on the same tick can neither miss a line nor receive one twice. */
function record(line) {
  const n = nextN++
  entries.push({ n, line })
  byteSize += Buffer.byteLength(line) + 1
  while (byteSize > BUFFER_MAX_BYTES && entries.length > 1) {
    byteSize -= Buffer.byteLength(entries.shift().line) + 1
  }
  for (const reader of readers) reader.onLine(line, n)
}

/** Point-in-time copy of the replay tail (lines only — the legacy full replay). */
function snapshot() {
  return entries.map((e) => e.line)
}

/** Indexed replay: only entries with `n > after` (a cursor-aware reader resumes where it left off). */
function snapshotAfter(after) {
  return entries.filter((e) => e.n > after)
}

/** Highest index assigned so far (0 = nothing recorded yet this boot). */
function lastIndex() {
  return nextN - 1
}

/** Subscribe a live reader; returns an unsubscribe for when its response drops. */
function subscribe(reader) {
  readers.add(reader)
  return () => readers.delete(reader)
}

/** Drop the buffer (a fresh session, e.g. after the engine restarts). Readers stay attached to hear it. */
function reset() {
  entries = []
  byteSize = 0
}

module.exports = { record, snapshot, snapshotAfter, lastIndex, subscribe, reset, BUFFER_MAX_BYTES, BOOT_ID }
