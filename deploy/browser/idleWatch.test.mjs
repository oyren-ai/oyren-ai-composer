import test from "node:test"
import assert from "node:assert/strict"
import { countViewers, createIdleWatch } from "./idleWatch.mjs"

// Real /proc/net/tcp shape: 6091 = 0x17CB. Row 1 is the LISTENING socket (state 0A), row 2 a
// viewer's accepted socket (state 01), row 3 the router's own end of that same loopback pair
// (6091 is its REMOTE port — counting it would double every viewer), row 4 an unrelated service.
const PROC = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:17CB 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 490684 1 0
   1: 0100007F:17CB 0100007F:C4E2 01 00000000:00000000 00:00000000 00000000  1000        0 490999 1 0
   2: 0100007F:C4E2 0100007F:17CB 01 00000000:00000000 00:00000000 00000000  1000        0 491000 1 0
   3: 0100007F:1388 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 500763 1 0
`

test("counts viewers as ESTABLISHED sockets whose LOCAL port is the stream's", () => {
  assert.equal(countViewers(PROC, 6091), 1) // not 2: the router's own end must not double-count
  assert.equal(countViewers(PROC, 5000), 0) // listening only ⇒ nobody watching
  assert.equal(countViewers("", 6091), 0)
  assert.equal(countViewers(undefined, 6091), 0)
})

test("a listener with no clients is the idle case, not a viewer", () => {
  const listenOnly = PROC.split("\n").filter((l) => !l.includes(" 01 ")).join("\n")
  assert.equal(countViewers(listenOnly, 6091), 0)
})

test("stops once the window passes with nobody watching", () => {
  let t = 1000, viewers = 0
  const w = createIdleWatch({ port: 6091, idleMs: 60_000, now: () => t, readProc: () => (viewers ? PROC : "") })
  assert.equal(w.tick().idle, false)
  t += 59_000
  assert.equal(w.tick().idle, false) // inside the window
  t += 2_000
  assert.equal(w.tick().idle, true) // past it
})

test("any viewer resets the clock, so a long login with the tab open never trips", () => {
  let t = 0, viewers = 0
  const w = createIdleWatch({ port: 6091, idleMs: 60_000, now: () => t, readProc: () => (viewers ? PROC : "") })
  t = 50_000; viewers = 1
  assert.equal(w.tick().viewers, 1)
  t = 100_000 // 100s in total, but only 50s since the viewer was seen
  assert.equal(w.tick().idle, false)
  viewers = 0
  t = 155_000
  assert.equal(w.tick().idle, false) // 55s since last seen — a brief drop costs a tick, not the session
  t = 175_000
  assert.equal(w.tick().idle, true)
})

test("idleMs <= 0 disables the timeout (OYREN_BROWSER_IDLE_MINUTES=0)", () => {
  let t = 0
  const w = createIdleWatch({ port: 6091, idleMs: 0, now: () => t, readProc: () => "" })
  t = 86_400_000
  assert.equal(w.tick().idle, false)
})
