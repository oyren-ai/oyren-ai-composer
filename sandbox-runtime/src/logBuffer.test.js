const { test } = require("node:test")
const assert = require("node:assert")
const { EventEmitter } = require("events")
const {
  record,
  recordChunk,
  installConsoleCapture,
  pipeChildOutput,
  snapshot,
  reset,
} = require("./logBuffer")

test.beforeEach(() => reset())

test("record + snapshot returns lines oldest first", () => {
  record("stdout", "first")
  record("stderr", "second")
  const lines = snapshot()
  assert.deepEqual(lines.map((l) => l.text), ["first", "second"])
  assert.deepEqual(lines.map((l) => l.stream), ["stdout", "stderr"])
})

test("recordChunk splits multi-line chunks and carries partial lines across calls", () => {
  recordChunk("stdout", "line one\nline two\npartial-")
  recordChunk("stdout", "end\n")
  assert.deepEqual(snapshot().map((l) => l.text), ["line one", "line two", "partial-end"])
})

test("recordChunk with no trailing newline holds the line back until it completes", () => {
  recordChunk("stdout", "still going")
  assert.deepEqual(snapshot(), [])
  recordChunk("stdout", "...\n")
  assert.deepEqual(snapshot().map((l) => l.text), ["still going..."])
})

test("the buffer drops the oldest entries once it exceeds the byte cap", () => {
  const bigLine = "x".repeat(500_000) // 500KB; six of these (3MB) exceed the default 2MB cap
  for (let i = 0; i < 6; i++) record("stdout", `${i}-${bigLine}`)
  const lines = snapshot()
  assert.ok(lines.length < 6, "oldest entries should have been evicted")
  assert.ok(!lines.some((l) => l.text.startsWith("0-")), "the very first (oldest) entry should be gone")
  assert.ok(lines.some((l) => l.text.startsWith("5-")), "the most recent entry must survive")
})

test("snapshot returns a copy — mutating it does not affect the buffer", () => {
  record("stdout", "a")
  const s = snapshot()
  s.pop()
  assert.equal(snapshot().length, 1)
})

test("installConsoleCapture tees console.log into the buffer without swallowing the original call", () => {
  const origLog = console.log
  const seen = []
  console.log = (...args) => seen.push(args)
  try {
    installConsoleCapture() // patches the (now-mocked) console.log
    console.log("hello", 42)
  } finally {
    console.log = origLog
  }
  assert.deepEqual(seen, [["hello", 42]])
  assert.deepEqual(snapshot().map((l) => l.text), ["hello 42"])
})

test("installConsoleCapture is idempotent (patching twice does not double-record)", () => {
  installConsoleCapture()
  installConsoleCapture()
  console.info("once")
  assert.equal(snapshot().filter((l) => l.text === "once").length, 1)
})

function fakeChild() {
  const child = { stdout: new EventEmitter(), stderr: new EventEmitter() }
  return child
}

test("pipeChildOutput records stdout and stderr chunks under separate streams", () => {
  const child = fakeChild()
  pipeChildOutput(child)
  child.stdout.emit("data", Buffer.from("hello from app\n"))
  child.stderr.emit("data", Buffer.from("uh oh\n"))
  const lines = snapshot()
  assert.deepEqual(lines.map((l) => [l.stream, l.text]), [
    ["stdout", "hello from app"],
    ["stderr", "uh oh"],
  ])
})

test("pipeChildOutput is a no-op for a child with no piped stdio (e.g. stdio: inherit)", () => {
  assert.doesNotThrow(() => pipeChildOutput({}))
  assert.doesNotThrow(() => pipeChildOutput(null))
})
