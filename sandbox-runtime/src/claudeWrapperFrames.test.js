const { test } = require("node:test")
const assert = require("node:assert")
const { TYPES, HEADER_BYTES, encodeFrame, createFrameDecoder } = require("./claudeWrapperFrames")

const collect = () => {
  const frames = []
  const decoder = createFrameDecoder((f) => frames.push({ type: f.type, payload: Buffer.from(f.payload) }))
  return { frames, decoder }
}

test("src/claudeWrapperFrames is a true re-export of the wrapper's own codec — one wire format, no drift", () => {
  assert.equal(require("./claudeWrapperFrames"), require("../claude-wrapper/frames"))
})

test("round-trip: every frame type encodes and decodes byte-exact", () => {
  const { frames, decoder } = collect()
  for (const type of Object.values(TYPES)) decoder.push(encodeFrame(type, Buffer.from(`payload-${type}`)))
  assert.deepEqual(frames.map((f) => f.type), Object.values(TYPES))
  for (const f of frames) assert.equal(f.payload.toString("utf8"), `payload-${f.type}`)
})

test("an empty payload (the 's' SIGTERM notice) round-trips as zero bytes", () => {
  const { frames, decoder } = collect()
  const encoded = encodeFrame(TYPES.SIGTERM)
  assert.equal(encoded.length, HEADER_BYTES)
  decoder.push(encoded)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].payload.length, 0)
})

test("chunked decode: one byte at a time still yields the exact frames, in order", () => {
  const { frames, decoder } = collect()
  const wire = Buffer.concat([
    encodeFrame(TYPES.STDOUT, Buffer.from('{"type":"result"}\n')),
    encodeFrame(TYPES.STDERR, Buffer.from("warning")),
  ])
  for (const byte of wire) decoder.push(Buffer.from([byte]))
  assert.equal(frames.length, 2)
  assert.equal(frames[0].type, TYPES.STDOUT)
  assert.equal(frames[0].payload.toString("utf8"), '{"type":"result"}\n')
  assert.equal(frames[1].type, TYPES.STDERR)
  assert.equal(frames[1].payload.toString("utf8"), "warning")
})

test("many frames arriving in one chunk all decode; a trailing partial frame waits for more bytes", () => {
  const { frames, decoder } = collect()
  const full = encodeFrame(TYPES.STDIN, Buffer.from("abc"))
  const partial = encodeFrame(TYPES.STDOUT, Buffer.from("delayed"))
  decoder.push(Buffer.concat([full, full, partial.subarray(0, 7)]))
  assert.equal(frames.length, 2, "the partial frame must not decode yet")
  decoder.push(partial.subarray(7))
  assert.equal(frames.length, 3)
  assert.equal(frames[2].payload.toString("utf8"), "delayed")
})

test("binary payloads survive untouched — no utf8 mangling of the byte stream", () => {
  const { frames, decoder } = collect()
  const payload = Buffer.from([0x00, 0xff, 0x0a, 0x80, 0x69])
  decoder.push(encodeFrame(TYPES.STDOUT, payload))
  assert.deepEqual(frames[0].payload, payload)
})
