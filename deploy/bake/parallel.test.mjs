// Tests for the bake's background-job runner (deploy/bake/parallel.sh).
//
// The helper exists so that overlapping work in the bake stays LOUD: `cmd &` does not trip
// `set -e`, and a bare `wait` throws the exit status away, so a failed install would be baked into
// the snapshot as a success. These tests pin the three properties that guarantee it cannot:
// the status propagates, the output is replayed whole under the job's name (never interleaved),
// and the jobs really do run concurrently — plus the errexit interaction, which is the subtle one.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "parallel.sh")

/** Run `body` as a bash script with parallel.sh sourced and a throwaway log dir. */
function run(body, { errexit = true } = {}) {
  const script = `${errexit ? "set -euo pipefail" : "set -uo pipefail"}\n. '${SCRIPT}'\n${body}\n`
  const started = Date.now()
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      BAKE_JOB_LOG_DIR: mkdtempSync(join(tmpdir(), "bake-jobs-")),
    },
  })
  return { ...r, ms: Date.now() - started }
}

test("a successful job replays its output under its own name and returns 0", () => {
  const r = run(`
    bg_start greeter bash -c 'echo hello-from-job; echo to-stderr >&2'
    bg_wait greeter
    echo "wait-returned=$?"
  `)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /background job 'greeter'/)
  assert.match(r.stdout, /hello-from-job/)
  // stderr is captured into the same log, so a job's error message cannot get separated from it.
  assert.match(r.stdout, /to-stderr/)
  assert.match(r.stdout, /wait-returned=0/)
})

test("a failing job propagates its exit status instead of being swallowed", () => {
  const r = run(
    `
    bg_start doomed bash -c 'echo about-to-fail; exit 7'
    bg_wait doomed && echo UNREACHABLE || echo "rc=$?"
  `,
    { errexit: false },
  )
  assert.match(r.stdout, /rc=7/)
  assert.match(r.stdout, /about-to-fail/)
  assert.match(r.stderr, /FAILED \(exit 7\)/)
  assert.doesNotMatch(r.stdout, /UNREACHABLE/)
})

test("under set -e a failing job kills the script — a broken install cannot be baked in", () => {
  const r = run(`
    bg_start doomed bash -c 'exit 3'
    bg_wait doomed
    echo SHOULD-NOT-GET-HERE
  `)
  assert.equal(r.status, 3)
  assert.doesNotMatch(r.stdout, /SHOULD-NOT-GET-HERE/)
})

test("job output is never interleaved: each job's lines arrive in one contiguous block", () => {
  const r = run(`
    bg_start alpha bash -c 'for i in 1 2 3; do echo alpha-$i; sleep 0.05; done'
    bg_start beta  bash -c 'for i in 1 2 3; do echo beta-$i;  sleep 0.05; done'
    bg_wait_all
  `)
  assert.equal(r.status, 0)
  const lines = r.stdout.split("\n").filter((l) => /^(alpha|beta)-/.test(l))
  assert.deepEqual(lines, ["alpha-1", "alpha-2", "alpha-3", "beta-1", "beta-2", "beta-3"])
})

test("jobs actually run concurrently", () => {
  const r = run(`
    bg_start one bash -c 'sleep 1'
    bg_start two bash -c 'sleep 1'
    bg_wait_all
  `)
  assert.equal(r.status, 0)
  assert.ok(r.ms < 1800, `two 1s jobs took ${r.ms}ms — they ran serially`)
})

test("bg_wait_all reaps every job even after one has failed", () => {
  const r = run(
    `
    bg_start first  bash -c 'echo first-ran;  exit 4'
    bg_start second bash -c 'echo second-ran; exit 0'
    bg_wait_all || echo "all-rc=$?"
  `,
    { errexit: false },
  )
  // The second job is still waited on and replayed, so nothing is left writing into the droplet.
  assert.match(r.stdout, /first-ran/)
  assert.match(r.stdout, /second-ran/)
  assert.match(r.stdout, /all-rc=4/)
})

test("waiting twice is a no-op rather than a hang or a bogus failure", () => {
  const r = run(`
    bg_start once bash -c 'echo done-once'
    bg_wait once
    bg_wait_all
    echo finished
  `)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /finished/)
  assert.equal(r.stdout.match(/done-once/g).length, 1)
})

test("a name that is not filename-safe is refused rather than writing somewhere unexpected", () => {
  const r = run(`bg_start '../escape' true || echo "rc=$?"`, { errexit: false })
  assert.match(r.stdout, /rc=2/)
  assert.match(r.stderr, /job name/)
})

test("waiting on a job that was never started is an error, not a silent success", () => {
  const r = run(`bg_wait ghost || echo "rc=$?"`, { errexit: false })
  assert.match(r.stdout, /rc=2/)
  assert.match(r.stderr, /no background job named 'ghost'/)
})
