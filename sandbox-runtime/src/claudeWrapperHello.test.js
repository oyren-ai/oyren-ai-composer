const { test } = require("node:test")
const assert = require("node:assert")
const { parseHello, resumeSessionId } = require("./claudeWrapperHello")

const goodHello = (over = {}) => JSON.stringify({
  v: 2, argv: ["/usr/bin/node", "/ext/cli.js", "--output-format", "stream-json"],
  cwd: "/home/oyren", env: { PATH: "/bin" }, pid: 42, ...over,
})

test("no newline yet returns null — wait for more bytes", () => {
  assert.equal(parseHello(Buffer.from(goodHello())), null)
})

test("a valid hello parses with argv/cwd/env/pid intact and trailing bytes preserved as rest", () => {
  const r = parseHello(Buffer.from(goodHello() + "\nFRAMED-BYTES"))
  assert.equal(r.error, undefined)
  assert.deepEqual(r.hello.argv, ["/usr/bin/node", "/ext/cli.js", "--output-format", "stream-json"])
  assert.equal(r.hello.cwd, "/home/oyren")
  assert.deepEqual(r.hello.env, { PATH: "/bin" })
  assert.equal(r.hello.pid, 42)
  assert.equal(r.rest.toString("utf8"), "FRAMED-BYTES")
})

test("malformed JSON is an error, not a crash and not a silent default", () => {
  assert.match(parseHello(Buffer.from("not json\n")).error, /not valid JSON/)
})

test("a v1-shaped hello (or any other version) is refused — no silent cross-version guessing", () => {
  assert.match(parseHello(Buffer.from('{"sessionKey":"default"}\n')).error, /unsupported hello version/)
  assert.match(parseHello(Buffer.from(goodHello({ v: 3 }) + "\n")).error, /unsupported hello version/)
})

test("an empty or non-string argv is refused — the broker must never guess what to spawn", () => {
  assert.match(parseHello(Buffer.from(goodHello({ argv: [] }) + "\n")).error, /argv/)
  assert.match(parseHello(Buffer.from(goodHello({ argv: ["ok", 5] }) + "\n")).error, /argv/)
  assert.match(parseHello(Buffer.from(goodHello({ argv: "claude" }) + "\n")).error, /argv/)
})

test("a missing cwd or env is refused", () => {
  assert.match(parseHello(Buffer.from(goodHello({ cwd: "" }) + "\n")).error, /cwd/)
  assert.match(parseHello(Buffer.from(goodHello({ env: null }) + "\n")).error, /env/)
  assert.match(parseHello(Buffer.from(goodHello({ env: ["PATH"] }) + "\n")).error, /env/)
})

test("resumeSessionId finds --resume <sid> anywhere in argv", () => {
  assert.equal(resumeSessionId(["/bin/claude", "--resume", "abc-123", "--verbose"]), "abc-123")
  assert.equal(resumeSessionId(["/bin/claude", "--verbose"]), null)
})

test("resumeSessionId refuses a flag masquerading as the sid, or a dangling --resume", () => {
  assert.equal(resumeSessionId(["/bin/claude", "--resume", "--verbose"]), null)
  assert.equal(resumeSessionId(["/bin/claude", "--resume"]), null)
})
