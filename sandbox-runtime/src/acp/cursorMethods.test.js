const { test } = require("node:test")
const assert = require("node:assert")
const { handleCursorMethod, handleCursorAskQuestion, handleCursorCreatePlan } = require("./cursorMethods")

test("ask_question picks the first option of each question", () => {
  const result = handleCursorAskQuestion({
    toolCallId: "c1",
    questions: [
      { id: "q1", prompt: "Mode?", options: [{ id: "agent", label: "Agent" }, { id: "plan", label: "Plan" }] },
      { id: "q2", prompt: "Color?", options: [{ id: "red", label: "Red" }] },
    ],
  })
  assert.deepEqual(result, {
    outcome: {
      outcome: "answered",
      answers: [
        { questionId: "q1", selectedOptionIds: ["agent"] },
        { questionId: "q2", selectedOptionIds: ["red"] },
      ],
    },
  })
})

test("ask_question with no usable questions skips", () => {
  assert.deepEqual(handleCursorAskQuestion({ questions: [] }), { outcome: { outcome: "skipped", reason: "no questions" } })
  assert.deepEqual(handleCursorAskQuestion({}), { outcome: { outcome: "skipped", reason: "no questions" } })
})

test("create_plan always accepts", () => {
  assert.deepEqual(handleCursorCreatePlan(), { outcome: { outcome: "accepted" } })
})

test("handleCursorMethod routes known methods and returns null for others", () => {
  assert.equal(handleCursorMethod("session/request_permission", {}), null)
  assert.deepEqual(handleCursorMethod("cursor/create_plan", {}), { outcome: { outcome: "accepted" } })
  assert.equal(handleCursorMethod("cursor/ask_question", { questions: [] }).outcome.outcome, "skipped")
})
