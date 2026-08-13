// Wire format for the wrapper<->broker relay (protocol v2). One frame:
//   [1-byte ASCII type][4-byte big-endian payload length][payload]
// Framing — instead of raw byte piping — is what keeps the child's stdout and stderr separate
// end-to-end (the extension reads NDJSON off stdout and must never see stderr noise mixed in) and
// what lets the broker report the child's exit in-band instead of overloading "socket closed".
//
// Types: wrapper->broker  'i' stdin bytes, 's' SIGTERM notice (panel close — payload empty)
//        broker->wrapper  'o' stdout bytes, 'e' stderr bytes, 'x' exit JSON {code,signal}
const TYPES = Object.freeze({ STDIN: "i", SIGTERM: "s", STDOUT: "o", STDERR: "e", EXIT: "x" })
const HEADER_BYTES = 5

function encodeFrame(type, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8")
  const header = Buffer.alloc(HEADER_BYTES)
  header.write(type, 0, 1, "ascii")
  header.writeUInt32BE(body.length, 1)
  return Buffer.concat([header, body])
}

/** Incremental decoder: feed arbitrarily-chunked bytes via push(); onFrame({type, payload}) fires
 *  once per complete frame, in arrival order. Partial frames wait for more bytes. */
function createFrameDecoder(onFrame) {
  let buf = Buffer.alloc(0)
  function push(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    while (buf.length >= HEADER_BYTES) {
      const size = buf.readUInt32BE(1)
      if (buf.length < HEADER_BYTES + size) return
      const type = String.fromCharCode(buf[0])
      const payload = buf.subarray(HEADER_BYTES, HEADER_BYTES + size)
      buf = buf.subarray(HEADER_BYTES + size)
      onFrame({ type, payload })
    }
  }
  return { push }
}

module.exports = { TYPES, HEADER_BYTES, encodeFrame, createFrameDecoder }
