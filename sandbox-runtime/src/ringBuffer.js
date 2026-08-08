// A byte-capped, cursor-addressable replay buffer with live fan-out — extracted from agentBroadcast.js
// (which was the first, module-singleton user) so the claude-process-wrapper broker can give each
// wrapped session its OWN instance instead of sharing the one global buffer. Behavior is unchanged for
// agentBroadcast's callers: it now just wraps one factory-created instance.
const crypto = require("crypto")

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024

/** Create one independent ring buffer: an append-only, byte-capped tail with a monotonic cursor `n`
 *  (never reused, even across reset()) and live subscribers. A cursor-aware reader can reconnect with
 *  `after=<n>` (snapshotAfter) and replay only what it hasn't seen, instead of re-ingesting on every
 *  reconnect. BOOT_ID is fresh per instance — a cursor from a different instance is meaningless. */
function createRingBuffer({ maxBytes } = {}) {
  const BUFFER_MAX_BYTES = maxBytes ?? (Number(process.env.AGENT_BUFFER_MAX_BYTES) || DEFAULT_MAX_BYTES)
  const BOOT_ID = crypto.randomUUID()

  let entries = [] // { n, line } — recent entries, oldest first (an "entry" is any opaque chunk, not necessarily one text line)
  let byteSize = 0
  let nextN = 1
  const readers = new Set() // { onLine(line, n) } — live attachers tailing the buffer

  /** Record one entry: append to the rolling tail (dropping oldest past the cap) then fan out to live
   *  readers. Fan-out is synchronous and AFTER the append, so a reader that snapshots the tail and then
   *  subscribes on the same tick can neither miss an entry nor receive one twice. */
  function record(line) {
    const n = nextN++
    entries.push({ n, line })
    byteSize += Buffer.byteLength(line) + 1
    while (byteSize > BUFFER_MAX_BYTES && entries.length > 1) {
      byteSize -= Buffer.byteLength(entries.shift().line) + 1
    }
    for (const reader of readers) reader.onLine(line, n)
  }

  /** Point-in-time copy of the replay tail (entries only — the legacy full replay). */
  function snapshot() {
    return entries.map((e) => e.line)
  }

  /** Indexed replay: only entries with `n > after` (a cursor-aware reader resumes where it left off). */
  function snapshotAfter(after) {
    return entries.filter((e) => e.n > after)
  }

  /** Highest index assigned so far (0 = nothing recorded yet this instance). */
  function lastIndex() {
    return nextN - 1
  }

  /** Subscribe a live reader; returns an unsubscribe for when it detaches. */
  function subscribe(reader) {
    readers.add(reader)
    return () => readers.delete(reader)
  }

  /** Drop the buffer (e.g. after the underlying engine restarts). Readers stay attached to hear it. */
  function reset() {
    entries = []
    byteSize = 0
  }

  return { record, snapshot, snapshotAfter, lastIndex, subscribe, reset, BUFFER_MAX_BYTES, BOOT_ID }
}

module.exports = { createRingBuffer, DEFAULT_MAX_BYTES }
