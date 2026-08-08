// Secondary ACP engines for the editor's agent-type picker: any CLI agent from the spawn table,
// started on demand BESIDE the launch agent, on the same workspace files.
//
// Deliberately NOT the main engine (acpEngine.js). That one is wired into the session's broadcast
// stream, turn tracking, recovery and reminders — all launch-agent machinery. A side engine's output
// belongs to exactly one caller (the editor chat session that asked for it), so its lines stream to
// a per-turn sink and never touch the pane's feed or the durable event log. One turn at a time per
// engine, and engines idle past the reap window are killed — each is a real CLI process, so RAM is
// the budget that matters, not sockets. claude-code stays launch-only (SDK engine, no ACP recipe).
const { spawnConfigFor } = require("./acp/spawnConfig")
const { sideEnvForKind, seedSideAuth } = require("./sideAgentAuth")
const { spawnAcpChild } = require("./acp/spawnChild")
const { handshake } = require("./acp/sessionStart")
const translate = require("./acp/translate")
const { makeModelSurface } = require("./acp/modelSurface")
const { currentModel } = require("./acp/models")
const { toPromptBlocks } = require("./acp/promptBlocks")
const { ensureHomeWritable } = require("./ensureHomeWritable")

const IDLE_REAP_MS = 10 * 60_000
const engines = new Map() // kind → instance
let spawnImpl = null // test seam, mirroring acpEngine's: inject a fake ACP child

/** A kind this module will run: has an ACP recipe and is NOT the session's own launch agent. */
function isSideKind(kind, env = process.env) {
  return !!kind && kind !== (env.AGENT_KIND || "") && !!spawnConfigFor(kind, env)
}

function drop(e) { engines.delete(e.kind); try { if (e.child && e.child.kill) e.child.kill() } catch {} }

async function start(e) {
  seedSideAuth(e.kind)
  const cfg = spawnConfigFor(e.kind, sideEnvForKind(e.kind))
  try { ensureHomeWritable() } catch {}
  const handle = spawnAcpChild({
    cfg, kind: e.kind, spawnImpl,
    onUpdate: (update) => { if (e.sink) translate.translateUpdate(e.tstate, update).forEach(e.sink) },
    onExit: (c) => { if (e.child === c) drop(e) },
  })
  e.child = handle.child; e.rpc = handle.rpc; e.stderrTail = handle.stderrTail
  const session = await handshake(e.rpc, { kind: e.kind, cwd: cfg.cwd })
  e.sessionId = session.sessionId
  e.models = session.models
  e.model = currentModel(session.models, e.model)
}

function engineFor(kind) {
  let e = engines.get(kind)
  if (e) return e
  e = { kind, child: null, rpc: null, sessionId: null, models: null, model: null, busy: false, sink: null, starting: null, lastUsed: Date.now(), tstate: translate.createState(), stderrTail: () => "" }
  e.surface = makeModelSurface({
    ensureStarted: () => ensureStarted(e), rpc: () => e.rpc, sessionId: () => e.sessionId,
    sessionModels: () => e.models, getModel: () => e.model, rememberModel: (id) => { e.model = id },
  })
  engines.set(kind, e)
  return e
}

function ensureStarted(e) {
  if (e.rpc && e.sessionId) return Promise.resolve()
  if (!e.starting) e.starting = start(e).catch((err) => { drop(e); throw err }).finally(() => { e.starting = null })
  return e.starting
}

/** Run ONE turn on the side engine `kind`, streaming every ndjson line to `sink(line)`. Always ends
 *  with a `result` line — including the busy and crashed cases — so callers can close on it. */
async function send(kind, payload, sink) {
  const e = engineFor(kind)
  e.lastUsed = Date.now()
  if (e.busy) return sink(JSON.stringify({ type: "result", is_error: true, error: `${kind} is already running a turn in this session` }))
  e.busy = true; e.sink = sink
  translate.beginTurn(e.tstate)
  try {
    await ensureStarted(e)
    const r = await e.rpc.request("session/prompt", { sessionId: e.sessionId, prompt: toPromptBlocks(payload) })
    translate.translateEnd(e.tstate, r && r.stopReason).forEach(sink)
  } catch (err) {
    // translateError surfaces the provider's login URL when auth is the failure — side agents other
    // than the launch one usually have no seeded credentials, and honesty beats a fake session.
    translate.translateError(e.tstate, { message: String((err && err.message) || err), stderr: e.stderrTail() }).forEach(sink)
  } finally {
    e.busy = false; e.sink = null; e.lastUsed = Date.now()
  }
}

async function interrupt(kind) { const e = engines.get(kind); if (e && e.rpc && e.sessionId) e.rpc.notify("session/cancel", { sessionId: e.sessionId }) }
async function listModels(kind) { return engineFor(kind).surface.listModels() }
async function setModel(kind, id) { return engineFor(kind).surface.setModel(id) }

// RAM guard: reap engines that have sat idle. Unref'd so it never holds the process open.
const reaper = setInterval(() => { for (const e of engines.values()) if (!e.busy && Date.now() - e.lastUsed > IDLE_REAP_MS) drop(e) }, 60_000)
if (reaper.unref) reaper.unref()

function __setSpawnImpl(fn) { spawnImpl = fn; for (const e of [...engines.values()]) drop(e) }

module.exports = { isSideKind, send, interrupt, listModels, setModel, __setSpawnImpl }
