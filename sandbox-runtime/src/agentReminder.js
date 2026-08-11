// Busy-turn continuity reminder (the first continuity layer): a message injected while the previous
// turn is still running gets a preamble re-anchoring the agent on the in-flight task, so a mid-build
// "how is it going?" never derails long-running work. The engines remember each turn-OPENING payload
// (rememberTask) and the busy reminder replays a truncated copy of it — busy path only, a normal
// not-busy follow-up passes through untouched.
const TASK_TEXT_MAX = 800

let taskText = null // text of the payload that OPENED the in-flight turn; null before any turn

const BUSY_REMINDER = [
  "Oyren conversation continuity reminder:",
  "The previous agent turn in this same chat is still in progress. Treat the next user message as a follow-up or status request about that in-flight work unless the user clearly changes topics.",
  "Continue using the existing task, repository, files, and commands from this conversation.",
].join("\n")

function textBlock(text) { return { type: "text", text } }

/** The text of a payload (string or content-block array) — what the busy reminder re-anchors on. */
function extractTaskText(payload) {
  if (Array.isArray(payload)) return payload.filter((b) => b && b.type === "text").map((b) => String(b.text || "")).join("\n").trim()
  return String(payload == null ? "" : payload).trim()
}

const truncateTask = (text, max = TASK_TEXT_MAX) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** Engines call this on every turn-opening send (NOT on busy follow-ups, which must never replace
 *  the task they ask about) so the reminder can restate what the agent is working on. */
function rememberTask(payload) {
  const text = extractTaskText(payload)
  taskText = text ? truncateTask(text) : null
}

function reminder() {
  if (!taskText) return BUSY_REMINDER
  return `${BUSY_REMINDER}\nThe task of that in-progress turn was: "${taskText}"\nAfter finishing it, address the user message below.`
}

function withBusyTurnReminder(payload) {
  if (Array.isArray(payload)) return [textBlock(reminder()), ...payload]
  return `${reminder()}\n\n${String(payload)}`
}

module.exports = { BUSY_REMINDER, withBusyTurnReminder, rememberTask, extractTaskText, truncateTask }
