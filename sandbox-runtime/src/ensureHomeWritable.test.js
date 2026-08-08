const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { ensureHomeWritable } = require("./ensureHomeWritable")

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-home-writable-"))

test("healthy HOME: creates .cache/.config, reports no repair, never shells out", () => {
  const home = tmpHome()
  const calls = []
  const repaired = ensureHomeWritable({ home, uid: process.getuid(), gid: process.getgid(), execImpl: (...a) => calls.push(a) })
  assert.equal(repaired, false)
  assert.deepEqual(calls, [])
  assert.ok(fs.statSync(path.join(home, ".cache")).isDirectory())
  assert.ok(fs.statSync(path.join(home, ".config")).isDirectory())
})

test("repairs a present-but-unwritable subdir (stands in for a root-owned dir in the real container)", () => {
  const home = tmpHome()
  const cacheDir = path.join(home, ".cache")
  fs.mkdirSync(cacheDir)
  fs.chmodSync(cacheDir, 0o500) // owner can't write — same symptom as another uid owning it
  const calls = []
  const execImpl = (cmd, args) => {
    calls.push([cmd, ...args])
    // Stand-in for what a real `sudo chown -R` would do: this test process already owns the dir (it's
    // not really root-owned), so model the observable effect — restore write access — after "chown".
    if (args[0] === "chown") fs.chmodSync(cacheDir, 0o700)
  }
  const repaired = ensureHomeWritable({ home, uid: process.getuid(), gid: process.getgid(), execImpl })
  assert.equal(repaired, true)
  assert.ok(calls.some((c) => c[0] === "sudo" && c[1] === "mkdir"))
  assert.ok(calls.some((c) => c[0] === "sudo" && c[1] === "chown"))
  assert.equal(fs.statSync(cacheDir).mode & 0o700, 0o700)
})

test("repairs HOME itself when it's present but unwritable, unblocking the nested dirs too", () => {
  const home = tmpHome()
  const calls = []
  fs.chmodSync(home, 0o500) // owner-unwritable HOME — same symptom as HOME being root-owned
  const execImpl = (cmd, args) => {
    calls.push([cmd, ...args])
    if (args[0] === "chown") fs.chmodSync(home, 0o700)
  }
  const repaired = ensureHomeWritable({ home, uid: process.getuid(), gid: process.getgid(), execImpl })
  fs.chmodSync(home, 0o700) // restore so the tmp dir cleans up
  assert.equal(repaired, true)
  assert.ok(calls.length > 0)
})

// The production case: DO App Platform's no-new-privileges makes sudo refuse, so `reclaim` changes
// nothing and ~/.cache stays unwritable. Without the redirect, opencode dies on `mkdir ~/.cache/opencode`.
test("redirects XDG_CACHE_HOME when the sudo repair leaves .cache unwritable", () => {
  const home = tmpHome()
  const cacheDir = path.join(home, ".cache")
  fs.mkdirSync(cacheDir)
  fs.chmodSync(cacheDir, 0o500)
  const env = {}
  const cacheFallback = path.join(tmpHome(), "fallback-cache")
  const repaired = ensureHomeWritable({ home, uid: process.getuid(), gid: process.getgid(), execImpl: () => {}, env, cacheFallback })
  fs.chmodSync(cacheDir, 0o700) // restore so the tmp dir cleans up
  assert.equal(repaired, true)
  assert.equal(env.XDG_CACHE_HOME, cacheFallback)
  assert.ok(fs.statSync(cacheFallback).isDirectory())
})

test("leaves XDG_CACHE_HOME alone on a healthy HOME", () => {
  const env = {}
  ensureHomeWritable({ home: tmpHome(), uid: process.getuid(), gid: process.getgid(), execImpl: () => {}, env })
  assert.equal(env.XDG_CACHE_HOME, undefined)
})

test("returns false without shelling out when uid/gid are unavailable", () => {
  const home = tmpHome()
  const calls = []
  const repaired = ensureHomeWritable({ home, uid: null, gid: null, execImpl: (...a) => calls.push(a) })
  assert.equal(repaired, false)
  assert.deepEqual(calls, [])
})
