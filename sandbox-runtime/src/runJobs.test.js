const { test } = require("node:test")
const assert = require("node:assert")
const { createRunJobs, PRUNE_AFTER_MS, MAX_CONCURRENT, LIST_TAIL_BYTES } = require("./runJobs")

const settle = () => new Promise((r) => setImmediate(r))
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const DONE = { stdout: "ok\n", stderr: "", exitCode: 0, timedOut: false }

test("lifecycle: start → running → done with the captured output", async () => {
  const jobs = createRunJobs()
  const d = deferred()
  const { runId } = jobs.start(() => d.promise)
  assert.match(runId, /^run-[0-9a-f]{16}$/)
  // Running state now includes partial output (empty initially)
  assert.deepEqual(jobs.result(runId), { status: "running", stdout: "", stderr: "" })
  d.resolve(DONE)
  await settle()
  assert.deepEqual(jobs.result(runId), { status: "done", ...DONE })
  assert.deepEqual(jobs.result(runId), { status: "done", ...DONE }) // result stays pollable until pruned
})

test("a rejected run resolves to a done result carrying the error (never throws at the poller)", async () => {
  const jobs = createRunJobs()
  const { runId } = jobs.start(() => Promise.reject(new Error("spawn exploded")))
  await settle()
  assert.deepEqual(jobs.result(runId), { status: "done", stdout: "", stderr: "spawn exploded", exitCode: null, timedOut: false })
})

test("an unknown or never-issued runId answers status unknown", () => {
  assert.deepEqual(createRunJobs().result("run-nope"), { status: "unknown" })
})

test("concurrency is capped: the excess start is an error, and a finished slot frees up", async () => {
  const jobs = createRunJobs()
  const pending = []
  for (let i = 0; i < MAX_CONCURRENT; i++) { const d = deferred(); pending.push(d); assert.ok(jobs.start(() => d.promise).runId) }
  const over = jobs.start(() => Promise.resolve(DONE))
  assert.match(over.error, /too many concurrent detached runs \(max 4\)/)
  assert.equal(over.runId, undefined)
  pending[0].resolve(DONE)
  await settle()
  assert.ok(jobs.start(() => deferred().promise).runId, "a completed job frees a slot")
})

test("completed jobs are pruned ~30min after completion → late polls answer unknown", async () => {
  let clock = 1_000_000
  const jobs = createRunJobs({ now: () => clock })
  const { runId } = jobs.start(() => Promise.resolve(DONE))
  await settle()
  clock += PRUNE_AFTER_MS // exactly at the boundary: still kept
  assert.equal(jobs.result(runId).status, "done")
  clock += 1 // past it: pruned
  assert.deepEqual(jobs.result(runId), { status: "unknown" })
})

test("running jobs are never pruned, no matter how old", async () => {
  let clock = 0
  const jobs = createRunJobs({ now: () => clock })
  const d = deferred()
  const { runId } = jobs.start(() => d.promise)
  clock += PRUNE_AFTER_MS * 10
  assert.deepEqual(jobs.result(runId), { status: "running", stdout: "", stderr: "" })
})

test("list(): records the command + startedAt and returns runs newest-first", async () => {
  let clock = 1000
  const jobs = createRunJobs({ now: () => clock })
  const d0 = deferred()
  const first = jobs.start(() => d0.promise, { command: "pnpm install" })
  clock += 5
  const second = jobs.start(() => Promise.resolve(DONE), { command: "pnpm test" })
  await settle()

  const list = jobs.list()
  assert.equal(list.length, 2)
  // newest (second) first
  assert.equal(list[0].runId, second.runId)
  assert.equal(list[0].command, "pnpm test")
  assert.equal(list[0].status, "done")
  assert.equal(list[0].exitCode, 0)
  assert.equal(list[0].stdout, "ok\n")
  // the still-running first job
  assert.equal(list[1].runId, first.runId)
  assert.equal(list[1].command, "pnpm install")
  assert.equal(list[1].status, "running")
  assert.equal(list[1].exitCode, null)
  assert.equal(list[1].startedAt, 1000)
})

test("list(): output is tail-truncated; get() returns the full untruncated output", async () => {
  const jobs = createRunJobs()
  const big = "x".repeat(LIST_TAIL_BYTES + 100)
  const { runId } = jobs.start(() => Promise.resolve({ stdout: big, stderr: "", exitCode: 0, timedOut: false }), { command: "big" })
  await settle()

  const listed = jobs.list()[0]
  assert.equal(listed.truncated, true)
  assert.ok(listed.stdout.startsWith("…[truncated]\n"))
  assert.ok(listed.stdout.length < big.length)

  const full = jobs.get(runId)
  assert.equal(full.truncated, false)
  assert.equal(full.stdout, big)
})

test("get(): unknown/pruned runId returns null", () => {
  assert.equal(createRunJobs().get("run-nope"), null)
})

test("partial output is visible while running via onOutput callback", async () => {
  const jobs = createRunJobs()
  const d = deferred()
  let capturedOnOutput
  const { runId } = jobs.start((onOutput) => {
    capturedOnOutput = onOutput
    return d.promise
  })

  // Initially empty
  assert.deepEqual(jobs.result(runId), { status: "running", stdout: "", stderr: "" })

  // start() invokes the run callback on a deferred microtask, so onOutput isn't captured until we
  // yield — same timing every real runner sees (it's handed the callback when its promise starts).
  await settle()

  // Simulate incremental output
  capturedOnOutput("hello ", "")
  assert.deepEqual(jobs.result(runId), { status: "running", stdout: "hello ", stderr: "" })

  capturedOnOutput("hello world\n", "warning\n")
  assert.deepEqual(jobs.result(runId), { status: "running", stdout: "hello world\n", stderr: "warning\n" })

  // Also visible in list()
  const listed = jobs.list()[0]
  assert.equal(listed.status, "running")
  assert.equal(listed.stdout, "hello world\n")
  assert.equal(listed.stderr, "warning\n")

  // After completion, final result takes over
  d.resolve({ stdout: "final output\n", stderr: "", exitCode: 0, timedOut: false })
  await settle()
  assert.deepEqual(jobs.result(runId), { status: "done", stdout: "final output\n", stderr: "", exitCode: 0, timedOut: false })
})
