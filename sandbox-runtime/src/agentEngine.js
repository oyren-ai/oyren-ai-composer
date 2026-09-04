// The persistent Claude Code session — ONE per container, alive for its whole life. Replaces the old
// one-shot `claude -p` per turn (agentTurn.js). Built on the Agent SDK's streaming-input `query()`, which
// is the only mode that supports what the interactive chat needs: inject a message mid-turn (steer),
// interrupt() a running turn (real Stop), and setModel()/supportedModels() at runtime. Output is the same
// stream-json the frontend already folds, so we just JSON.stringify each SDK message onto the broadcast.
// The SDK is ESM; we load it via dynamic import() from this CommonJS module.
const { WORKDIR } = require("./config")
const { readSessionId, writeSessionId } = require("./agentSession")
const { createInputStream, buildUserMessage } = require("./sdkInput")
const broadcast = require("./agentBroadcast")
const track = require("./agentTurnTrack")
const { withBusyTurnReminder, rememberTask } = require("./agentReminder")
const { maybeRecover, promptDropped } = require("./agentRecovery")
const { bumpTurnCount } = require("./agentMeta")

let input = null // { stream, push, close } — the live streaming-input handle
let queryObj = null // the SDK Query (control surface: interrupt/setModel/supportedModels)
let starting = null // in-flight ensureStarted() promise (single-flight guard)
let busy = false // a turn is being processed (send → true; result message → false)
let model = process.env.AGENT_MODEL || null // last-known model (init event or setModel)
let queryImpl = null // test seam: inject a fake `query` so unit tests never spawn the real SDK/claude

// Tests call this to swap in a fake `query` and reset session state between cases.
function __setQueryImpl(fn) { queryImpl = fn; queryObj = null; input = null; starting = null; busy = false }

const isResult = (m) => m && m.type === "result"

// Best-effort: push the agent-meta blob right when a turn finishes, not just on gitCheckpoint's 4-min
// tick. Closes the recovery blind window where a container restart shortly after real progress finds
// a stale/empty stored meta blob and silently fails the "[CONTEXT RECOVERY]" gate in agentRecovery.js
// — the model then gets no restart signal at all. Fire-and-forget: a turn must never wait on this, and
// reportMeta() already swallows every failure internally, but the require() itself is guarded too.
function reportMetaAfterTurn() {
  try { require("./agentMetaReport").reportMeta({ env: process.env }).catch(() => {}) } catch { /* best-effort */ }
}

// Consume the SDK message generator forever: record every message, keep session_id/model/busy current.
// The pump captures ITS OWN query object: after a reset() a successor session may already be live while
// this pump drains its tail, and a stale pump must neither clobber the successor's state nor re-persist
// the just-cleared session id.
async function pump() {
  const q = queryObj
  try {
    for await (const message of q) {
      const current = queryObj === q
      if (current && message && typeof message.session_id === "string") writeSessionId(message.session_id)
      if (current && message && message.type === "system" && message.model) model = message.model
      const result = isResult(message)
      if (result && current) { busy = false; reportMetaAfterTurn() }
      const line = JSON.stringify(message)
      track.recordLine(line, result) // mirror into the loop-compat turn (no-op unless an id-tagged turn is open)
      broadcast.record(line)
    }
  } catch (err) {
    if (queryObj === q) broadcast.record(JSON.stringify({ type: "result", is_error: true, error: String(err && err.message || err) }))
  } finally {
    // The session ended (SDK closed the stream / crashed). Drop it so the next send() starts a fresh one,
    // resuming the same claude session_id for continuity — unless a successor already took over.
    if (queryObj === q) { busy = false; queryObj = null; input = null; starting = null }
  }
}

async function ensureStarted() {
  if (queryObj) return
  if (starting) return starting
  starting = (async () => {
    const query = queryImpl || (await import("@anthropic-ai/claude-agent-sdk")).query
    input = createInputStream()
    const options = {
      cwd: WORKDIR,
      permissionMode: "bypassPermissions", // never hang a headless turn on a permission prompt
      includePartialMessages: true, // emit `stream_event` deltas the UI types out live
      resume: readSessionId() || undefined, // continue the container's prior session across restarts
    }
    if (model) options.model = model
    queryObj = query({ prompt: input.stream, options })
    pump() // fire-and-forget; runs for the session's life
  })()
  try { await starting } finally { if (queryObj) starting = null }
}

// Inject a user turn. `payload` = the frontend's content-block array or a bare prompt string. `turnId` is
// optional and only supplied by the loop engine (the browser UI reads /agent/stream and needs no id).
async function send(payload, turnId) {
  await ensureStarted() // start FIRST so a failed start never burns the once-per-boot recovery latch
  // Blank-boot recovery (a persisted session id means --resume carries the context instead; the
  // meta-gated preamble latches only when prepended, and the push below dispatches it immediately),
  // then the busy wrap; remember only turn-opening payloads as "the task" the busy reminder restates.
  const recovered = await maybeRecover(payload, { hasLocalSession: !!readSessionId() })
  if (!input) throw promptDropped(payload, recovered) // session died during the meta await — un-latch so the retry send still recovers
  const payloadForAgent = busy ? withBusyTurnReminder(recovered) : recovered
  if (!busy) rememberTask(payload)
  busy = true
  track.beginTurn(turnId)
  bumpTurnCount()
  input.push(buildUserMessage(payloadForAgent))
}

async function interrupt() { if (queryObj) await queryObj.interrupt(); busy = false }

// Conversation reset (POST /agent/reset): interrupt any running turn FIRST (the interrupt-before-
// switch ordering next's useGuardedModelSelect.ts documents), then tear the live session down and
// clear the persisted resume id, so the next send() starts a genuinely fresh conversation instead
// of --resume'ing the old one. Idempotent; a no-op-safe sequence when nothing is running.
async function reset() {
  try { if (queryObj) await queryObj.interrupt() } catch { /* a dying session must not block the reset */ }
  try { if (input && input.close) input.close() } catch { /* ditto */ }
  busy = false; queryObj = null; input = null; starting = null
  writeSessionId("")
}
async function listModels() { await ensureStarted(); return { models: await queryObj.supportedModels(), current: model } }
async function setModel(id) { await ensureStarted(); await queryObj.setModel(id || undefined); model = id || null }
const replayTurn = (turnId) => track.replay(turnId) // loop reconcile: buffered lines for an id-tagged turn
const state = () => ({ busy, model, started: !!queryObj, ...track.turnState() })

module.exports = { send, interrupt, reset, listModels, setModel, state, replayTurn, __setQueryImpl }
