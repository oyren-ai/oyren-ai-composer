// Pure ACP → stream-json translation. Turns `session/update` notification params plus turn-end /
// error events into the EXACT ndjson lines the frontend transcript reducer already folds for the
// Claude SDK engine (see the ACP plan's mapping table): streamed text arrives as `stream_event`
// deltas under a synthetic message id, and the SAME id carries the consolidated `assistant` line at
// close so the reducer replaces the placeholder instead of duplicating it. State (open text block,
// seen tool ids, per-turn plan ids) is created by createState() and threaded through every call.
const J = JSON.stringify

function createState() { return { seq: 0, textId: null, text: "", tools: {}, planMsgId: null, planToolId: null } }
function beginTurn(s) { s.textId = null; s.text = ""; s.planMsgId = null; s.planToolId = null }
const nextId = (s) => `acp-${++s.seq}`

const streamEvent = (event) => J({ type: "stream_event", event })
const assistantLine = (id, content) => J({ type: "assistant", message: { id, role: "assistant", content } })
const toolResultLine = (toolUseId, content, isError) =>
  J({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: !!isError }] } })
const blockText = (c) => (c && typeof c.text === "string" ? c.text : "")

/** Finalize the open streamed text block as a consolidated assistant line (same id ⇒ reducer upsert). */
function closeText(s) {
  if (!s.textId) return []
  const line = assistantLine(s.textId, [{ type: "text", text: s.text }])
  s.textId = null
  s.text = ""
  return [line]
}

function textChunk(s, text) {
  const lines = []
  if (!s.textId) {
    s.textId = nextId(s)
    lines.push(streamEvent({ type: "message_start", message: { id: s.textId } }))
    lines.push(streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text" } }))
  }
  s.text += text
  lines.push(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }))
  return lines
}

function toolCall(s, u) {
  const name = u.title || u.kind || "tool"
  s.tools[u.toolCallId] = name
  return [...closeText(s), assistantLine(nextId(s), [{ type: "tool_use", id: u.toolCallId, name, input: u.rawInput !== undefined ? u.rawInput : {} }])]
}

/** Best-effort human-readable output of a finished tool call (ACP nests text under content[].content). */
function toolOutputText(u) {
  const parts = (Array.isArray(u.content) ? u.content : [])
    .map((c) => (c && c.type === "content" ? blockText(c.content) : ""))
    .filter(Boolean)
  if (parts.length) return parts.join("\n")
  if (u.rawOutput === undefined || u.rawOutput === null) return ""
  return typeof u.rawOutput === "string" ? u.rawOutput : J(u.rawOutput)
}

function toolUpdate(s, u) {
  if (u.status !== "completed" && u.status !== "failed") return [] // pending/in_progress → nothing to render yet
  const lines = s.tools[u.toolCallId] ? [] : toolCall(s, u) // a result for a call we never saw → synthesize the call
  lines.push(toolResultLine(u.toolCallId, toolOutputText(u), u.status === "failed"))
  return lines
}

/** Plan updates render as ONE synthetic "plan" tool call per turn: stable message/tool ids make every
 *  refresh replace the previous plan card (reducer upserts by message id) instead of stacking new ones. */
function plan(s, u) {
  if (!s.planMsgId) { s.planMsgId = nextId(s); s.planToolId = nextId(s) }
  const entries = Array.isArray(u.entries) ? u.entries : []
  const summary = entries.map((e) => `[${e && e.status || "pending"}] ${e && e.content || ""}`).join("\n")
  return [
    assistantLine(s.planMsgId, [{ type: "tool_use", id: s.planToolId, name: "plan", input: { entries } }]),
    toolResultLine(s.planToolId, summary, false),
  ]
}

/** One `session/update` → zero or more stream-json lines. Unknown kinds translate to nothing. */
function translateUpdate(s, update) {
  if (!update || typeof update !== "object") return []
  switch (update.sessionUpdate) {
    case "agent_message_chunk": return textChunk(s, blockText(update.content))
    case "agent_thought_chunk":
      return [streamEvent({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: blockText(update.content) } })]
    case "tool_call": return toolCall(s, update)
    case "tool_call_update": return toolUpdate(s, update)
    case "plan": return plan(s, update)
    default: return []
  }
}

/** `session/prompt` resolved: consolidate open text, then the terminal result line. */
function translateEnd(s, stopReason) {
  return [...closeText(s), J({ type: "result", subtype: stopReason === "cancelled" ? "cancelled" : "success" })]
}

/** A turn (or session start) died: optional login-URL assistant text, then an is_error result. */
function translateError(s, { message, subtype, loginUrl, stderr } = {}) {
  const lines = closeText(s)
  if (loginUrl) lines.push(assistantLine(nextId(s), [{ type: "text", text: `This agent needs you to sign in first — open this link to authenticate:\n${loginUrl}` }]))
  const result = { type: "result", is_error: true, error: message || "agent error" }
  if (subtype) result.subtype = subtype
  // The CLI's own last words. Without this, a crash reaches the durable event log as nothing but
  // "agent process exited (code 1)" — a real opencode failure was undiagnosable for exactly this
  // reason, since the tail only ever went to container logs that die with the container.
  if (stderr) result.stderr = stderr
  return [...lines, J(result)]
}

module.exports = { createState, beginTurn, translateUpdate, translateEnd, translateError }
