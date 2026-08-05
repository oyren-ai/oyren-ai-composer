const vscode = require("vscode")
const { createClient } = require("./agentClient")
const { foldLine, chatSink } = require("./renderStream")
const { createModelProvider } = require("./modelProvider")

/**
 * The production successor to oyren-chat-probe: VS Code's built-in Chat view, backed by the sandbox
 * agent for ALL seven providers (docs/oyren-chat-participant.md). The extension host runs inside the
 * droplet, so it dials the runtime directly on 127.0.0.1 — no CORS, no trip through the edge.
 *
 * Registration is wrapped, never thrown: a thrown activation is indistinguishable from the Chat view
 * simply being absent, and the two failures have completely different fixes.
 */

const NO_AGENT = "There is no sandbox agent attached to this editor (no session token), so there is nobody to answer."
const BUSY = "A turn is already running in this session."

// One turn at a time, enforced with the latch on client.state (shared with the lm provider): the
// sandbox runs ONE persistent agent session — Oyren's own chat pane drives the same engine — so a
// second concurrent turn would not run in parallel, it would double-drive the same stream.
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

function activate(context) {
  const client = createClient()

  if (vscode.chat && typeof vscode.chat.createChatParticipant === "function") {
    try {
      context.subscriptions.push(vscode.chat.createChatParticipant("oyren.agent", makeHandler(client)))
    } catch (err) {
      console.error(`oyren-agent: participant registration failed: ${err && err.message}`)
    }
  }

  // The model picker path. Registered even with no session token: the provider's fallback model is
  // what keeps the picker populated on a self-hosted editor instead of an empty, nagging dropdown.
  if (vscode.lm && typeof vscode.lm.registerLanguageModelChatProvider === "function") {
    try {
      context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider("oyren", createModelProvider(client)))
      // Force EAGER model resolution. The workbench resolves a vendor's models lazily unless the
      // user has previously stored a pick of that vendor — and the extension host resolves a model
      // BEFORE invoking the participant handler, so an unresolved vendor can throw "Language model
      // unavailable" without our code ever running. One select at activation runs the resolution
      // now, and fills the picker with real model names instead of the synthetic "Auto" entry.
      vscode.lm.selectChatModels({ vendor: "oyren" }).then(undefined, () => {})
    } catch (err) {
      console.error(`oyren-agent: model provider registration failed: ${err && err.message}`)
    }
  }
}

function deactivate() {}

module.exports = { activate, deactivate }
