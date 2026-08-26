const { test } = require("node:test")
const assert = require("node:assert/strict")
const { explainError, formatDiff, formatDone, formatStatus, formatVersion } = require("./updateFormat")

test("formatDiff mirrors the updater's summary lines", () => {
  assert.equal(formatDiff([]), "up to date")
  assert.equal(formatDiff([{ component: "claude", from: "2.1.191", to: "2.1.235" }, { component: "lean", from: null, to: "v4" }]), "claude 2.1.191 → 2.1.235\nlean (none) → v4")
})

test("formatVersion names the image and lists components; a manifest-less image is explained", () => {
  const out = formatVersion({ version: "2026-08-25-1838", family: "base", builtAt: "2026-08-25T18:38:00Z", composerSha: "342436e", components: { claude: "2.1.235", lean: null } })
  assert.match(out, /^Oyren Codespace image base 2026-08-25-1838, built 2026-08-25T18:38:00Z from composer 342436e/)
  assert.match(out, /claude\s+2\.1\.235/)
  assert.match(out, /lean\s+\(none\)/)
  assert.match(formatVersion(null), /predates version manifests/)
})

test("formatStatus covers idle, running, done and failed", () => {
  assert.equal(formatStatus(null), "no update has run on this machine")
  assert.equal(formatStatus({ state: "running", step: "applying:claude", from: "a", to: "b", unit: "oyren-update-1" }), "updating a → b: applying:claude (unit oyren-update-1)")
  assert.equal(formatStatus({ state: "done", to: "b", applied: ["claude", "runtime"] }), "updated to b (claude, runtime)")
  assert.equal(formatStatus({ state: "failed", step: "restarting", from: "a", to: "b", error: "no health" }), "update a → b failed at restarting: no health")
})

test("explainError gives a next step per failing step, and formatDone says what restarted", () => {
  assert.match(explainError({ step: "fetching" }), /fresh ones/)
  assert.match(explainError({ step: "verifying" }), /Nothing on this machine was changed/)
  assert.match(explainError({ step: "applying:dsh", log: "/tmp/l" }), /before dsh is in place/)
  assert.match(explainError({ step: "applying:dsh", log: "/tmp/l" }), /\/tmp\/l/)
  assert.match(explainError({ step: "restarting" }), /rolled back/)
  assert.match(explainError({}), /--status/)
  assert.match(formatDone({ to: "b", applied: ["runtime"] }), /tmux session and the agent in it survived/)
  assert.match(formatDone({ to: "b", applied: ["editor"] }), /reload its tab/)
  assert.equal(formatDone({ to: "b", applied: ["claude"] }), "Updated to b (claude).")
})
