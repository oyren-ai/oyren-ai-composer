// The session's live output fan-out + a rolling replay buffer. Every SDK message the engine produces is
// recorded here as one ndjson line, fanned out to all currently-attached readers (GET /agent/stream), and
// kept in a byte-capped tail so a reader that connects (or reconnects after a drop) replays recent context
// — typically the in-flight turn — before tailing live. Unlike the old per-turn log this is continuous for
// the container's life; the cap (oldest lines dropped) keeps memory bounded during hours-long sessions.
// Each line carries a monotonic index `n` (never reused, even across reset()) and the process exposes a
// BOOT_ID, so a cursor-aware reader (the orchestrator's pull pump) can reconnect with `after=<n>` and
// replay only what it hasn't seen — instead of re-ingesting the whole buffer on every tunnel blip.
//
// A thin singleton wrapper around ringBuffer.js's factory — this was the buffer shape's first caller,
// extracted so claudeWrapperRegistry.js can give each wrapped session its own independent instance.
const { createRingBuffer } = require("./ringBuffer")

module.exports = createRingBuffer()
