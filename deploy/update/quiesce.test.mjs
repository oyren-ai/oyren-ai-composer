// The quiesce is what runs right before a snapshot, so what matters is the plan: the tmux layout
// is SAVED while the server is still up, then the server goes down (every shell and the agent),
// caches under /root and /var go, nothing under /home is named, and `cloud-init clean` is the very
// last thing. --dry-run prints exactly that plan.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "oyren-quiesce.sh")

/** A PATH with a fake systemctl that reports every unit active, so the plan includes the stops. */
function fakeBin() {
  const bin = mkdtempSync(join(tmpdir(), "quiesce-bin-"))
  writeFileSync(join(bin, "systemctl"), '#!/bin/sh\n[ "$1" = "is-active" ] && exit 0\necho "systemctl $*"\n')
  chmodSync(join(bin, "systemctl"), 0o755)
  return bin
}

test("--dry-run --json prints the plan and a JSON summary that says nothing was cleaned", () => {
  const r = spawnSync("bash", [SCRIPT, "--dry-run", "--json"], { encoding: "utf8", env: { PATH: `${fakeBin()}:${process.env.PATH}` } })
  assert.equal(r.status, 0, r.stderr)
  const summary = JSON.parse(r.stdout)
  assert.deepEqual(summary.stopped, ["oyren-tmux", "oyren-browser", "oyren-zed"])
  assert.equal(summary.cloudInitCleaned, false)
  assert.equal(summary.dryRun, true)
  assert.equal(typeof summary.diskUsedBytes, "number")
  const plan = r.stderr.split("\n").filter((l) => l.startsWith("would: "))
  assert.equal(plan[0], "would: systemctl start oyren-tmux-save.service", "the layout is saved while the server is up")
  assert.equal(plan[1], "would: systemctl stop oyren-tmux", "then the shells go")
  assert.equal(plan[plan.length - 1], "would: cloud-init clean --logs", "cloud-init clean is last")
  assert.ok(plan.some((l) => l.startsWith("would: rm -rf /var/lib/apt/lists") && l.includes("/root/.npm /root/.cache")), "apt lists and root caches are cleaned")
  assert.ok(plan.some((l) => l.includes("rm -f /etc/oyren/editor-surface")))
  assert.ok(!plan.some((l) => /\/home\b/.test(l)), "nothing under /home is ever named")
  assert.ok(!plan.some((l) => /pnpm/.test(l)), "the pnpm store stays")
})

test("--dry-run without --json is the same plan in plain text; an unknown flag is a usage error", () => {
  const r = spawnSync("bash", [SCRIPT, "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH } })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /would: cloud-init clean --logs/)
  assert.match(r.stdout, /✅ quiesced/)
  assert.equal(spawnSync("bash", [SCRIPT, "--frobnicate"], { encoding: "utf8" }).status, 2)
})
