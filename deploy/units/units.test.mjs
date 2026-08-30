// The tmux unit triad, pinned as text: the server unit that restores on every start, the oneshot
// save, and the two-minute timer. Shipped-dead units are exactly what startTmux.test.mjs exists
// for at the exec level; THIS file pins the wiring systemd never type-checks (a misspelled Wants=
// or a missing PartOf= fails silently forever).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(HERE, rel), "utf8")
const TMUX = read("oyren-tmux.service")
const SAVE = read("oyren-tmux-save.service")
const TIMER = read("oyren-tmux-save.timer")

test("the server unit restores on EVERY start, tolerantly, before the runtime is allowed up", () => {
  assert.match(TMUX, /^ExecStartPost=-\/usr\/bin\/node \/usr\/local\/lib\/oyren\/tmux-state\.mjs restore$/m)
  assert.match(TMUX, /^Wants=oyren-tmux-save\.timer$/m)
  assert.match(read("oyren-sandbox.service.d/20-tmux.conf"), /After=oyren-tmux\.service/)
})

test("the save oneshot runs as the sandbox user with the session env, never at boot without one", () => {
  assert.match(SAVE, /^Type=oneshot$/m)
  assert.match(SAVE, /^User=oyren$/m)
  assert.match(SAVE, /^EnvironmentFile=\/etc\/oyren\/host\.env$/m)
  assert.match(SAVE, /^EnvironmentFile=\/etc\/oyren\/sandbox\.env$/m)
  assert.match(SAVE, /^ConditionPathExists=\/etc\/oyren\/sandbox\.env$/m)
  assert.match(SAVE, /tmux-state\.mjs save$/m)
})

test("the timer lives and dies with the server and never self-installs", () => {
  assert.match(TIMER, /^PartOf=oyren-tmux\.service$/m)
  assert.match(TIMER, /^OnActiveSec=2min$/m)
  assert.match(TIMER, /^OnUnitActiveSec=2min$/m)
  assert.match(TIMER, /^Unit=oyren-tmux-save\.service$/m)
  assert.doesNotMatch(TIMER, /\[Install\]/)
})

test("the installers ship the pair, hash deploy/units, and start the timer on a live update", () => {
  const helpers = readFileSync(join(HERE, "../sandbox-host/runtime-helpers.sh"), "utf8")
  assert.match(helpers, /oyren-tmux-save\.service/)
  assert.match(helpers, /oyren-tmux-save\.timer/)
  const installer = readFileSync(join(HERE, "../sandbox-host/install-runtime.sh"), "utf8")
  assert.match(installer, /tree_hash sandbox-runtime deploy\/sandbox-host deploy\/units/)
  assert.match(installer, /systemctl start oyren-tmux-save\.timer/)
  const release = readFileSync(join(HERE, "../bake/build-release.sh"), "utf8")
  assert.match(release, /tree_hash sandbox-runtime deploy\/sandbox-host deploy\/units/, "a unit-only change must not be invisible to oyren update --check")
})
