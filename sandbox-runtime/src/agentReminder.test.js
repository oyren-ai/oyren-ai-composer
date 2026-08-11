const { test } = require("node:test")
const assert = require("node:assert")
const { BUSY_REMINDER, withBusyTurnReminder, rememberTask, extractTaskText, truncateTask } = require("./agentReminder")

test("extractTaskText reads a bare string, joins the text blocks of an array, and skips images", () => {
  assert.equal(extractTaskText("  fix the build  "), "fix the build")
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } }
  assert.equal(extractTaskText([image, { type: "text", text: "part one" }, { type: "text", text: "part two" }]), "part one\npart two")
  assert.equal(extractTaskText([image]), "")
  assert.equal(extractTaskText(null), "")
})

test("truncateTask caps at 800 chars with an ellipsis and leaves short text alone", () => {
  assert.equal(truncateTask("short"), "short")
  const long = "x".repeat(900)
  const got = truncateTask(long)
  assert.equal(got.length, 801)
  assert.ok(got.endsWith("…"))
})

test("the busy reminder restates the remembered task ahead of the follow-up (string payload)", () => {
  rememberTask("refactor the auth module and run the tests")
  const got = withBusyTurnReminder("how is it going?")
  assert.match(got, /The previous agent turn in this same chat is still in progress/)
  assert.match(got, /The task of that in-progress turn was: "refactor the auth module and run the tests"/)
  assert.match(got, /how is it going\?$/)
})

test("array payloads get the reminder (with task text) as a leading text block", () => {
  rememberTask([{ type: "text", text: "build the feature" }])
  const got = withBusyTurnReminder([{ type: "text", text: "status?" }])
  assert.equal(got.length, 2)
  assert.match(got[0].text, /build the feature/)
  assert.deepEqual(got[1], { type: "text", text: "status?" })
})

test("without a remembered task the reminder is the base text only", () => {
  rememberTask("") // an empty/imageless payload clears the memory
  assert.equal(withBusyTurnReminder("ping"), `${BUSY_REMINDER}\n\nping`)
})

test("a very long task is truncated inside the reminder", () => {
  rememberTask(`start: ${"y".repeat(900)}`)
  const got = withBusyTurnReminder("still going?")
  assert.match(got, /The task of that in-progress turn was: "start: y+…"/)
})
