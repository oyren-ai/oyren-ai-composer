// Auto-answer Cursor ACP extension methods so a headless sandbox turn never hangs waiting for a
// human. Cursor's ACP server sends these as agent→client REQUESTS (blocking) in addition to the
// standard session/request_permission — without handlers, spawnChild rejects with -32601 and the
// agent stalls mid-turn.
//
//   cursor/ask_question  → pick the first option of each question (unattended default)
//   cursor/create_plan   → accept so plan-mode turns can proceed
//
// Notification-only extensions (cursor/update_todos, cursor/task, cursor/generate_image) never
// reach here — jsonrpc routes those through onNotification, which ignores unknowns.

function handleCursorAskQuestion(params) {
  const questions = Array.isArray(params && params.questions) ? params.questions : []
  const answers = questions.map((q) => {
    const options = Array.isArray(q && q.options) ? q.options : []
    const first = options[0]
    return {
      questionId: q && q.id,
      selectedOptionIds: first && first.id != null ? [first.id] : [],
    }
  }).filter((a) => a.questionId != null)
  if (!answers.length) return { outcome: { outcome: "skipped", reason: "no questions" } }
  return { outcome: { outcome: "answered", answers } }
}

function handleCursorCreatePlan() {
  return { outcome: { outcome: "accepted" } }
}

/** Return a result for a known Cursor extension method, or null when the method is not ours. */
function handleCursorMethod(method, params) {
  if (method === "cursor/ask_question") return handleCursorAskQuestion(params)
  if (method === "cursor/create_plan") return handleCursorCreatePlan(params)
  return null
}

module.exports = { handleCursorMethod, handleCursorAskQuestion, handleCursorCreatePlan }
