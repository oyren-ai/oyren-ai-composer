import test from "node:test"
import assert from "node:assert/strict"
import { clearStaleProfileLock, isStaleLock, readLockOwner } from "./chromeProfileLock.mjs"

const HERE = "oyren-app-tlbo9e-w8w3"
const GONE = "oyren-app-tktevm-nh96" // the container this Codespace replaced
const PROFILE = "/home/oyren/.oyren-browser"
const CLEARED = [`${PROFILE}/SingletonLock`, `${PROFILE}/SingletonCookie`, `${PROFILE}/SingletonSocket`]

/** A clearStaleProfileLock run over a fake profile. `lock` = what SingletonLock points at, or an
 *  Error to throw from readlink (ENOENT = no lock; EINVAL = present but not a symlink). */
const run = (lock, alive = () => false) => {
  const removed = []
  const readLink = () => {
    if (lock instanceof Error) throw lock
    return lock
  }
  const cleared = clearStaleProfileLock(PROFILE, { host: HERE, alive, readLink, remove: (p) => removed.push(p) })
  return { cleared, removed }
}

const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" })

test("reads Chrome's <hostname>-<pid>, splitting at the last dash — our hostnames are full of them", () => {
  assert.deepEqual(readLockOwner(`${GONE}-1099758`), { host: GONE, pid: 1099758 })
  assert.equal(readLockOwner("no-pid-here"), null)
  assert.equal(readLockOwner(null), null)
})

test("a lock from a container that no longer exists is stale — the case Chrome itself gives up on", () => {
  assert.equal(isStaleLock(`${GONE}-1099758`, { host: HERE, alive: () => true }), true)
})

test("on this host, the pid decides", () => {
  assert.equal(isStaleLock(`${HERE}-4242`, { host: HERE, alive: () => false }), true)
  assert.equal(isStaleLock(`${HERE}-4242`, { host: HERE, alive: () => true }), false)
})

test("breaks a dead lock's three files together, and says which lock it broke", () => {
  const { cleared, removed } = run(`${GONE}-1099758`)
  assert.equal(cleared, `${GONE}-1099758`)
  assert.deepEqual(removed, CLEARED)
})

test("leaves a live local Chrome's profile alone", () => {
  assert.deepEqual(run(`${HERE}-4242`, () => true), { cleared: null, removed: [] })
})

test("a first start has no lock and nothing to do", () => {
  assert.deepEqual(run(enoent), { cleared: null, removed: [] })
})

test("a lock that is not a symlink is a profile no Chrome can open either, so it goes too", () => {
  const einval = Object.assign(new Error("EINVAL"), { code: "EINVAL" })
  assert.deepEqual(run(einval).removed, CLEARED)
})
