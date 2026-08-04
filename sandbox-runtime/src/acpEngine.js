// The persistent ACP session for NON-Claude coding agents (codex/gemini/qwen/opencode/cursor/
// antigravity) — same public interface as agentEngine.js (send/interrupt/listModels/setModel/state/
// replayTurn), selected by engineSelect.js on AGENT_KIND. Lazily spawns the provider's ACP binary
// (acp/spawnChild), drives it over NDJSON JSON-RPC (acp/sessionStart handshake → one session/prompt
// per send), and translates session/update notifications into the SAME stream-json lines the frontend
// reducer folds for the SDK engine (acp/recordLines). A crashed agent yields an is_error result and
// respawns on the next send — resuming its persisted session when the provider supports session/load;
// `sessionLoaded` = THIS boot genuinely resumed the prior conversation, and only that suppresses the
// recovery preamble. Helpers: acp/turnFinish (turn-end bookkeeping), acp/modelSurface (list/set model).
const track = require("./agentTurnTrack")
const { ensureHomeWritable } = require("./ensureHomeWritable")
const { spawnConfigFor } = require("./acp/spawnConfig")
const { spawnAcpChild } = require("./acp/spawnChild")
const { handshake } = require("./acp/sessionStart")
const translate = require("./acp/translate")
const { recordLines } = require("./acp/recordLines")
const { makeTurnFinishers } = require("./acp/turnFinish")
const { makeModelSurface } = require("./acp/modelSurface")
const { currentModel } = require("./acp/models")
const { toPromptBlocks } = require("./acp/promptBlocks")
const { withBusyTurnReminder, rememberTask } = require("./agentReminder")
const { maybeRecover, promptDropped } = require("./agentRecovery")
const { bumpTurnCount } = require("./agentMeta")

let child = null, rpc = null, sessionId = null, starting = null, sessionModels = null, sessionLoaded = false
let busy = false, pendingPrompts = 0, generation = 0
let model = process.env.AGENT_MODEL || null
let stderrTail = () => "" // rolling tail handle, scanned for login URLs on auth failures
let tstate = translate.createState()
let spawnImpl = null // test seam: inject a fake ACP child so unit tests never exec a real CLI

// Tests call this to swap in a fake spawn and reset session state between cases.
function __setSpawnImpl(fn) { spawnImpl = fn; generation++; dropSession(); sessionLoaded = false; busy = false; pendingPrompts = 0; model = process.env.AGENT_MODEL || null; tstate = translate.createState() }

function dropSession() { child = null; rpc = null; sessionId = null; starting = null; sessionModels = null }
function killChild() { const c = child; dropSession(); try { if (c && c.kill) c.kill() } catch {} }

const { finishTurn, finishError } = makeTurnFinishers({
  isStale: (gen) => gen !== generation,
  settle: () => { pendingPrompts = Math.max(0, pendingPrompts - 1); busy = pendingPrompts > 0 },
  tstate: () => tstate, stderrTail: () => stderrTail(), killChild,
})

async function startSession() {
  const kind = process.env.AGENT_KIND || ""
  const cfg = spawnConfigFor(kind)
  if (!cfg) throw new Error(`no ACP launcher for agent kind "${kind}"`)
  // Self-heal a root-owned HOME/.cache/.config before spawning: this is the "Agent app" (HTTP chat)
  // path, which runs independently of (and can race ahead of) agent-launch.sh's own seed steps — see
  // ensureHomeWritable.js. Cheap + a silent no-op on the healthy path; never throws.
  try { ensureHomeWritable() } catch {}
  const handle = spawnAcpChild({
    cfg, kind, spawnImpl,
    onUpdate: (update) => recordLines(translate.translateUpdate(tstate, update)),
    onExit: (c) => { if (child === c) dropSession() },
  })
  child = handle.child; rpc = handle.rpc; stderrTail = handle.stderrTail
  const session = await handshake(rpc, { kind, cwd: cfg.cwd })
  sessionId = session.sessionId
  sessionLoaded = !!session.loaded
  sessionModels = session.models
  model = currentModel(sessionModels, model)
  recordLines([JSON.stringify({ type: "system", subtype: "init", session_id: sessionId, model: model || undefined, tools: [] })])
}

async function ensureStarted() {
  if (rpc && sessionId) return
  if (!starting) starting = startSession().catch((e) => { killChild(); throw e }).finally(() => { starting = null })
  return starting
}

// Inject a user turn. `payload` = the frontend's content-block array or a bare prompt string; `turnId`
// only rides on loop sends. Resolves once the prompt is dispatched — output streams via the broadcast.
async function send(payload, turnId) {
  const gen = generation
  const opening = pendingPrompts === 0 // remember only turn-opening payloads as "the task"
  if (opening) rememberTask(payload)
  pendingPrompts++
  busy = true
  track.beginTurn(turnId)
  translate.beginTurn(tstate)
  // Start FIRST: the recovery decision needs the ACTUAL session-load outcome; the once-per-boot latch is
  // only consumed by a dispatched prompt — a failed start skips it, a mid-await child exit un-latches below.
  try { await ensureStarted() } catch (e) { finishError(e, gen); return }
  const recovered = await maybeRecover(payload, { hasLocalSession: sessionLoaded })
  if (!rpc || gen !== generation) return finishError(promptDropped(payload, recovered), gen)
  const payloadForAgent = opening ? recovered : withBusyTurnReminder(recovered)
  bumpTurnCount()
  rpc.request("session/prompt", { sessionId, prompt: toPromptBlocks(payloadForAgent) })
    .then((r) => finishTurn(r && r.stopReason, gen))
    .catch((e) => finishError(e, gen))
}

async function interrupt() { if (rpc && sessionId) rpc.notify("session/cancel", { sessionId }); busy = false; pendingPrompts = 0 } // prompt resolves stopReason=cancelled

const { listModels, setModel } = makeModelSurface({
  ensureStarted, rpc: () => rpc, sessionId: () => sessionId,
  sessionModels: () => sessionModels, getModel: () => model, rememberModel: (id) => { model = id },
})

const replayTurn = (turnId) => track.replay(turnId)
const state = () => ({ busy, model, started: !!sessionId, ...track.turnState() })

module.exports = { send, interrupt, listModels, setModel, state, replayTurn, __setSpawnImpl }
