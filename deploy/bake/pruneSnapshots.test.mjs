// Tests for the snapshot prune PLAN — the part that decides what gets deleted. The DO calls are
// deliberately not exercised: the risk here is the selection rule, not the HTTP.
import { test } from "node:test"
import assert from "node:assert/strict"
import { familyOf, planPrune, reclaimedGb } from "./pruneSnapshots.mjs"

const snap = (name, created_at, id, size_gigabytes = 10) => ({ id, name, created_at, size_gigabytes })

const ACCOUNT = [
  snap("oyren-sandbox-base-2026-08-01-1000", "2026-08-01T10:00:00Z", "b1"),
  snap("oyren-sandbox-base-2026-08-10-1000", "2026-08-10T10:00:00Z", "b2"),
  snap("oyren-sandbox-base-2026-08-19-1000", "2026-08-19T10:00:00Z", "b3"),
  snap("oyren-sandbox-zed-2026-08-02-1000", "2026-08-02T10:00:00Z", "z1", 12),
  snap("oyren-sandbox-zed-2026-08-18-1000", "2026-08-18T10:00:00Z", "z2", 12),
  snap("oyren-sandbox-lean-2026-07-01-1000", "2026-07-01T10:00:00Z", "l1", 20),
  snap("my-own-backup", "2026-01-01T10:00:00Z", "x1"),
  snap("oyren-sandbox-experimental-2026-08-01-1000", "2026-08-01T10:00:00Z", "x2"),
]

const ids = (plan, family, key) => plan.find((f) => f.family === family)[key].map((s) => s.id)

test("only the bake's own snapshot names are candidates", () => {
  assert.equal(familyOf("oyren-sandbox-base-2026-08-19-1000"), "base")
  assert.equal(familyOf("oyren-sandbox-zed-2026-08-19-1000"), "zed")
  assert.equal(familyOf("oyren-sandbox-lean-2026-08-21-0101"), "lean")
  assert.equal(familyOf("oyren-sandbox-leanfoundation-2026-08-21-2000"), "leanfoundation")
  assert.equal(familyOf("my-own-backup"), null)
  assert.equal(familyOf("oyren-sandbox-experimental-2026-08-01-1000"), null)
  assert.equal(familyOf(undefined), null)
})

test("keeps the newest N per family and deletes the rest", () => {
  const plan = planPrune(ACCOUNT, { keep: 2 })
  assert.deepEqual(ids(plan, "base", "kept"), ["b3", "b2"])
  assert.deepEqual(ids(plan, "base", "deleted"), ["b1"])
  assert.deepEqual(ids(plan, "zed", "deleted"), [])
})

test("a foreign snapshot is never in any plan", () => {
  const everything = planPrune(ACCOUNT, { keep: 1 }).flatMap((f) => [...f.kept, ...f.deleted]).map((s) => s.id)
  assert.ok(!everything.includes("x1"))
  assert.ok(!everything.includes("x2"))
})

test("protected ids survive even when they fall outside the keep window", () => {
  const plan = planPrune(ACCOUNT, { keep: 1, protectIds: ["b1"] })
  assert.deepEqual(ids(plan, "base", "kept"), ["b3", "b1"])
  assert.deepEqual(ids(plan, "base", "deleted"), ["b2"])
  assert.equal(plan.find((f) => f.family === "base").kept[1].reason, "protected")
})

test("protect accepts numeric ids as the DO API returns them", () => {
  const numeric = [snap("oyren-sandbox-base-2026-08-01-1000", "2026-08-01T10:00:00Z", 111), snap("oyren-sandbox-base-2026-08-02-1000", "2026-08-02T10:00:00Z", 222)]
  const plan = planPrune(numeric, { keep: 1, protectIds: [111] })
  assert.deepEqual(ids(plan, "base", "deleted"), [])
})

test("keep is clamped to 1 — a run must never empty a family", () => {
  for (const keep of [0, -3, NaN]) {
    const plan = planPrune(ACCOUNT, { keep })
    assert.deepEqual(ids(plan, "base", "kept"), ["b3"], `keep=${keep}`)
    assert.deepEqual(ids(plan, "lean", "deleted"), [], `keep=${keep}`)
  }
})

test("keep defaults to 2 — the current image plus one to roll back to", () => {
  assert.deepEqual(ids(planPrune(ACCOUNT), "base", "kept"), ["b3", "b2"])
})

test("a family with fewer snapshots than keep loses nothing", () => {
  const plan = planPrune(ACCOUNT, { keep: 5 })
  assert.deepEqual(plan.flatMap((f) => f.deleted), [])
})

test("an empty family is reported, not skipped", () => {
  const plan = planPrune([], { keep: 2 })
  assert.deepEqual(plan.map((f) => f.family), ["base", "zed", "lean", "leanfoundation"])
  assert.deepEqual(plan.flatMap((f) => f.kept), [])
})

test("ordering is by created_at, not by name or list order", () => {
  const shuffled = [
    snap("oyren-sandbox-zed-a", "2026-08-02T10:00:00Z", "old"),
    snap("oyren-sandbox-zed-z", "2026-08-20T10:00:00Z", "new"),
    snap("oyren-sandbox-zed-m", "2026-08-11T10:00:00Z", "mid"),
  ]
  const plan = planPrune(shuffled, { keep: 1 })
  assert.deepEqual(ids(plan, "zed", "kept"), ["new"])
  assert.deepEqual(ids(plan, "zed", "deleted"), ["mid", "old"])
})

test("reports the GB the plan reclaims", () => {
  assert.equal(reclaimedGb(planPrune(ACCOUNT, { keep: 1 })), 10 + 10 + 12) // b1+b2 (10 each) + z1 (12)
  assert.equal(reclaimedGb(planPrune(ACCOUNT, { keep: 9 })), 0)
})
