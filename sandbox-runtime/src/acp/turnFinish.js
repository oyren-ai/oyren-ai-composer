// Turn-end bookkeeping for the ACP engine, extracted from acpEngine.js: settle the pending-prompt
// counter and emit the closing stream-json lines for a finished or failed session/prompt. The engine
// hands over its mutable surface via `ctx` getters/actions so the generation guard (a __setSpawnImpl
// reset invalidates in-flight completions) keeps working across the module boundary.
const translate = require("./translate")
const { isAuthError, findLoginUrl } = require("./authError")
const { recordLines } = require("./recordLines")

/** Bound so one runaway CLI can't bloat every event-log row; the last lines are the useful ones. */
const STDERR_TAIL_CHARS = 2000
const tail = (text) => {
  const s = String(text || "").trim()
  return s ? s.slice(-STDERR_TAIL_CHARS) : undefined
}

/** ctx: { isStale(gen), settle(), tstate(), stderrTail(), killChild() } */
function makeTurnFinishers(ctx) {
  function finishTurn(stopReason, gen) {
    if (ctx.isStale(gen)) return
    ctx.settle()
    recordLines(translate.translateEnd(ctx.tstate(), stopReason))
  }
  function finishError(err, gen) {
    if (ctx.isStale(gen)) return
    ctx.settle()
    const message = String((err && err.message) || err)
    if (isAuthError(err)) {
      recordLines(translate.translateError(ctx.tstate(), { message, subtype: "auth_required", loginUrl: findLoginUrl(err, ctx.stderrTail()) }))
      ctx.killChild() // next send retries initialize + session/new — the user may have logged in meanwhile
      return
    }
    // A crash already dropped the session via the exit hook (respawn on next send); a plain rpc error
    // keeps the live session for the next turn. Either way the turn ends with an is_error result.
    //
    // On a crash (`exited`), carry the CLI's stderr tail into the result so the durable event log
    // holds WHY it died — container logs vanish with the container, so a bare "agent process exited
    // (code 1)" left the real cause unrecoverable after the fact.
    recordLines(translate.translateError(ctx.tstate(), { message, stderr: err && err.exited ? tail(ctx.stderrTail()) : undefined }))
  }
  return { finishTurn, finishError }
}

module.exports = { makeTurnFinishers }
