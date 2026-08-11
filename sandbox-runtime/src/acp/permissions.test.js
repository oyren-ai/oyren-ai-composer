const { test } = require("node:test")
const assert = require("node:assert")
const { choosePermissionOutcome } = require("./permissions")

const opt = (optionId, kind) => ({ optionId, kind, name: kind })

test("allow_always wins whenever offered (regardless of order)", () => {
  const params = { options: [opt("o1", "allow_once"), opt("o2", "reject_once"), opt("o3", "allow_always")] }
  assert.deepEqual(choosePermissionOutcome(params), { outcome: { outcome: "selected", optionId: "o3" } })
})

test("falls back to allow_once when allow_always is absent", () => {
  const params = { options: [opt("r", "reject_once"), opt("a", "allow_once")] }
  assert.deepEqual(choosePermissionOutcome(params), { outcome: { outcome: "selected", optionId: "a" } })
})

test("with no allow option at all, selects a reject option so the turn keeps moving", () => {
  const params = { options: [opt("ra", "reject_always"), opt("ro", "reject_once")] }
  assert.deepEqual(choosePermissionOutcome(params), { outcome: { outcome: "selected", optionId: "ro" } })
})

test("no usable options ⇒ cancelled outcome (never throws)", () => {
  assert.deepEqual(choosePermissionOutcome({ options: [] }), { outcome: { outcome: "cancelled" } })
  assert.deepEqual(choosePermissionOutcome({}), { outcome: { outcome: "cancelled" } })
  assert.deepEqual(choosePermissionOutcome(null), { outcome: { outcome: "cancelled" } })
})

test("Cursor-style kebab optionIds without kind still auto-allow", () => {
  const params = { options: [{ optionId: "allow-once" }, { optionId: "reject-once" }] }
  assert.deepEqual(choosePermissionOutcome(params), { outcome: { outcome: "selected", optionId: "allow-once" } })
  const always = { options: [{ optionId: "reject-once" }, { optionId: "allow-always" }] }
  assert.deepEqual(choosePermissionOutcome(always), { outcome: { outcome: "selected", optionId: "allow-always" } })
})
