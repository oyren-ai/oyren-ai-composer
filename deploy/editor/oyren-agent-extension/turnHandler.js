// The one chat turn handler, shared by the default participant (the launch agent) and every
// per-agent chat session (sessionProviders.js) — the only difference between them is which client
// they hold, and the client already knows its ?agent= kind.
const { foldLine, chatSink } = require("./renderStream")

const NO_AGENT = "There is no sandbox agent attached to this editor (no session token), so there is nobody to answer."
const BUSY = "A turn is already running for this agent."

/** One turn at a time, enforced with the latch on client.state: each engine is ONE persistent
 *  session (Oyren's own chat pane drives the launch engine too), so a second concurrent turn would
 *  not run in parallel — it would double-drive the same stream. */
function makeHandler(client) {
  return async (request, _context, stream, token) => {
    if (!client.token) return void stream.markdown(NO_AGENT)
    if (client.state.busy) return void stream.markdown(BUSY)
    const prompt = (request.prompt || "").trim()
    // The runtime 400s an empty message; that must not masquerade as an unreachable agent below.
    if (!prompt) return void stream.markdown("There is nothing to send — type a message for the agent.")
    client.state.busy = true
    const subs = []
    try {
      // The picker's choice arrives as request.model; the session only follows it if told.
      if (request.model && request.model.vendor === "oyren") await client.ensureModel(request.model.id)
      const sink = chatSink(stream)
      const turn = client.streamTurn(prompt, (line) => { if (foldLine(line, sink)) turn.cancel() })
      subs.push(token.onCancellationRequested(() => { client.interrupt().catch(() => {}); turn.cancel() }))
      await turn.done
    } catch {
      // Connection refused / non-200. One sentence, never a stack trace — this renders in the chat.
      stream.markdown(`The sandbox agent isn't reachable on 127.0.0.1:${client.port}.`)
    } finally {
      client.state.busy = false
      for (const sub of subs) sub.dispose()
    }
  }
}

module.exports = { makeHandler }
