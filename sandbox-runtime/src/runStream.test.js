const { test, beforeEach, afterEach, describe } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const path = require("path")
const os = require("os")
const { runStreaming, listRunLogs, readRunLog } = require("./runStream")

// Mock response object that collects SSE events
function mockResponse() {
  const events = []
  let ended = false
  let headers = null
  return {
    writeHead(status, h) { headers = { status, ...h } },
    write(data) { events.push(data) },
    end() { ended = true },
    on(event, cb) { /* ignore close handler in tests */ },
    get events() { return events },
    get ended() { return ended },
    get headers() { return headers },
    parseEvents() {
      // Parse SSE format into structured events
      const parsed = []
      let current = {}
      for (const chunk of events) {
        const lines = chunk.split("\n")
        for (const line of lines) {
          if (line.startsWith("event: ")) current.event = line.slice(7)
          else if (line.startsWith("data: ")) current.data = JSON.parse(line.slice(6))
          else if (line === "") {
            if (current.event || current.data) parsed.push(current)
            current = {}
          }
        }
      }
      return parsed
    }
  }
}

describe("runStreaming", () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runstream-test-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("streams stdout and sends done event with exit code", async () => {
    const res = mockResponse()

    await new Promise((resolve) => {
      const originalEnd = res.end.bind(res)
      res.end = () => { originalEnd(); resolve() }
      runStreaming(res, "echo hello", { cwd: tmpDir, workdir: tmpDir })
    })

    assert.equal(res.headers.status, 200)
    assert.equal(res.headers["content-type"], "text/event-stream")
    assert.equal(res.ended, true)

    const events = res.parseEvents()
    assert.ok(events.some(e => e.event === "start"), "should have start event")
    assert.ok(events.some(e => e.event === "stdout" && e.data.includes("hello")), "should have stdout with hello")
    assert.ok(events.some(e => e.event === "done" && e.data.exitCode === 0), "should have done event with exit code 0")
  })

  test("streams stderr separately from stdout", async () => {
    const res = mockResponse()

    await new Promise((resolve) => {
      const originalEnd = res.end.bind(res)
      res.end = () => { originalEnd(); resolve() }
      runStreaming(res, "echo error >&2", { cwd: tmpDir, workdir: tmpDir })
    })

    const events = res.parseEvents()
    assert.ok(events.some(e => e.event === "stderr" && e.data.includes("error")), "should have stderr event")
  })

  test("creates log file in .oyren-deliver", async () => {
    const res = mockResponse()

    await new Promise((resolve) => {
      const originalEnd = res.end.bind(res)
      res.end = () => { originalEnd(); resolve() }
      runStreaming(res, "echo logged", { cwd: tmpDir, workdir: tmpDir })
    })

    const deliverDir = path.join(tmpDir, ".oyren-deliver")
    assert.ok(fs.existsSync(deliverDir), ".oyren-deliver should exist")

    const logs = fs.readdirSync(deliverDir).filter(f => f.endsWith(".log"))
    assert.equal(logs.length, 1, "should have one log file")

    const logContent = fs.readFileSync(path.join(deliverDir, logs[0]), "utf-8")
    assert.ok(logContent.includes("logged"), "log should contain output")
    assert.ok(logContent.includes("Exit code: 0"), "log should contain exit code")
  })

  test("returns runId in start event and log filename matches", async () => {
    const res = mockResponse()

    await new Promise((resolve) => {
      const originalEnd = res.end.bind(res)
      res.end = () => { originalEnd(); resolve() }
      runStreaming(res, "echo test", { cwd: tmpDir, workdir: tmpDir })
    })

    const events = res.parseEvents()
    const startEvent = events.find(e => e.event === "start")
    assert.ok(startEvent, "should have start event")
    assert.ok(startEvent.data.runId, "start event should have runId")
    assert.ok(startEvent.data.runId.startsWith("run-"), "runId should start with run-")

    // Verify log file exists with matching name
    const logPath = path.join(tmpDir, ".oyren-deliver", `${startEvent.data.runId}.log`)
    assert.ok(fs.existsSync(logPath), "log file should exist with runId name")
  })
})

describe("listRunLogs", () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runlogs-test-"))
    fs.mkdirSync(path.join(tmpDir, ".oyren-deliver"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("returns empty array when no logs exist", () => {
    const logs = listRunLogs(tmpDir)
    assert.deepEqual(logs, [])
  })

  test("returns log files sorted by mtime (newest first)", () => {
    const deliverDir = path.join(tmpDir, ".oyren-deliver")
    fs.writeFileSync(path.join(deliverDir, "run-old.log"), "old")
    fs.writeFileSync(path.join(deliverDir, "run-new.log"), "new")
    // Touch the old file to make it older
    const oldTime = new Date(Date.now() - 10000)
    fs.utimesSync(path.join(deliverDir, "run-old.log"), oldTime, oldTime)

    const logs = listRunLogs(tmpDir)
    assert.equal(logs.length, 2)
    assert.equal(logs[0].name, "run-new.log")
    assert.equal(logs[1].name, "run-old.log")
  })

  test("ignores non-log files", () => {
    const deliverDir = path.join(tmpDir, ".oyren-deliver")
    fs.writeFileSync(path.join(deliverDir, "run-test.log"), "test")
    fs.writeFileSync(path.join(deliverDir, "other.txt"), "ignored")
    fs.writeFileSync(path.join(deliverDir, "notarun.log"), "ignored")

    const logs = listRunLogs(tmpDir)
    assert.equal(logs.length, 1)
    assert.equal(logs[0].name, "run-test.log")
  })
})

describe("readRunLog", () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "readlog-test-"))
    fs.mkdirSync(path.join(tmpDir, ".oyren-deliver"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("returns log content for valid runId", () => {
    fs.writeFileSync(path.join(tmpDir, ".oyren-deliver", "run-abc123.log"), "test content")
    const content = readRunLog(tmpDir, "run-abc123")
    assert.equal(content, "test content")
  })

  test("returns null for non-existent runId", () => {
    const content = readRunLog(tmpDir, "run-doesnotexist")
    assert.equal(content, null)
  })
})
