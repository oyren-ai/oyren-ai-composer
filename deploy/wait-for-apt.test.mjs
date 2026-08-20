// Tests for the bake's apt-lock wait (wait-for-apt.sh).
//
// The script exists because a bake died on `E: Could not get lock /var/lib/apt/lists/lock` while
// cloud-init was still installing, so the behaviour that matters is: does it actually notice a held
// lock, does it stop waiting once released, and does it always let the bake continue. All three are
// exercised against real flock(2) on temp files via APT_WAIT_LOCKS.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "wait-for-apt.sh")

const lockFile = () => {
  const path = join(mkdtempSync(join(tmpdir(), "apt-wait-")), "lock")
  writeFileSync(path, "")
  return path
}

/** Run the script against `locks`, returning its output and how long it blocked. */
function run(locks, env = {}) {
  const started = process.hrtime.bigint()
  const r = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      APT_WAIT_LOCKS: locks,
      APT_WAIT_INTERVAL_SECS: "1",
      APT_WAIT_TIMEOUT_SECS: "10",
      ...env,
    },
  })
  return { ...r, ms: Number((process.hrtime.bigint() - started) / 1_000_000n) }
}

/** Hold an exclusive flock on `path` for `seconds`, resolving once the holder has it. */
function hold(path, seconds) {
  const child = spawn("flock", ["-x", path, "sleep", String(seconds)])
  return new Promise((resolve) => setTimeout(() => resolve(child), 300))
}

test("a free lock does not delay the bake", () => {
  const r = run(lockFile())
  assert.equal(r.status, 0)
  assert.ok(r.ms < 3000, `took ${r.ms}ms`)
  assert.equal(r.stdout.trim(), "")
})

test("a held lock is waited out, and the bake continues once it clears", async () => {
  const path = lockFile()
  await hold(path, 3)
  const r = run(path)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /locked by another process/)
  assert.match(r.stdout, /apt free after \d+s/)
  assert.ok(r.ms >= 1000, `returned in ${r.ms}ms — it cannot have waited`)
})

test("a lock held past the timeout warns but still exits 0 — apt reports the real error", async () => {
  const path = lockFile()
  await hold(path, 6)
  const r = run(path, { APT_WAIT_TIMEOUT_SECS: "2" })
  assert.equal(r.status, 0, "must never fail the bake itself")
  assert.match(r.stderr, /still locked after 2s — continuing anyway/)
})

test("several locks: any one held is enough to wait", async () => {
  const free = lockFile()
  const busy = lockFile()
  await hold(busy, 3)
  const r = run(`${free} ${busy}`)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /locked by another process/)
})

test("a lock path that does not exist is ignored, not an error", () => {
  const r = run("/definitely/not/here/lock")
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), "")
})

test("an unwritable lock is skipped — a non-root caller must not stall", () => {
  // flock could not open it, so every probe would read as "held"; the script skips those instead.
  const path = lockFile()
  chmodSync(path, 0o444)
  const r = run(path)
  assert.equal(r.status, 0)
  assert.ok(r.ms < 3000, `took ${r.ms}ms`)
})
