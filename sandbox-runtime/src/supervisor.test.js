const { test } = require("node:test")
const assert = require("node:assert")
const { Supervisor } = require("./supervisor")

// Fake child_process.spawn: records calls and lets a test emit the child's "exit".
function fakeSpawn(record) {
  return (cmd, args, opts) => {
    const handlers = {}
    const child = {
      cmd, args, opts,
      on: (ev, cb) => { handlers[ev] = cb },
      kill: () => { record.killed = true },
      emitExit: (code) => handlers.exit && handlers.exit(code),
    }
    record.calls.push(child)
    return child
  }
}

const resolveOk = { resolveField: async () => "node app.js" }
const resolveEmpty = { resolveField: async () => "" }

test("expose records the port without spawning, and stays unmanaged", () => {
  const rec = { calls: [] }
  const s = new Supervisor({ workdir: "/w", resolve: resolveOk, spawnFn: fakeSpawn(rec), probe: async () => true })
  const status = s.expose(3000)
  assert.equal(status.exposedPort, 3000)
  assert.equal(status.managed, false)
  assert.equal(rec.calls.length, 0)
})

test("start spawns the resolved command with PORT and reaches running when the probe passes", async () => {
  const rec = { calls: [] }
  const s = new Supervisor({ workdir: "/w", resolve: resolveOk, spawnFn: fakeSpawn(rec), probe: async () => true })
  const status = await s.start(3000)
  assert.equal(status.state, "running")
  assert.equal(status.managed, true)
  assert.equal(rec.calls.length, 1)
  assert.deepEqual(rec.calls[0].args, ["-lc", "node app.js"])
  assert.equal(rec.calls[0].opts.env.PORT, "3000")
  // session-control secrets must never reach user code
  assert.equal(rec.calls[0].opts.env.SESSION_TOKEN, undefined)
  assert.equal(rec.calls[0].opts.env.CONTROL_TOKEN, undefined)
  assert.equal(rec.calls[0].opts.env.GITHUB_TOKEN, undefined)
})

test("start stays in 'starting' when nothing is listening yet", async () => {
  const rec = { calls: [] }
  const s = new Supervisor({ workdir: "/w", resolve: resolveOk, spawnFn: fakeSpawn(rec), probe: async () => false })
  const status = await s.start(3000)
  assert.equal(status.state, "starting")
})

test("start crashes with a clear error when the manifest has no start command", async () => {
  const s = new Supervisor({ workdir: "/w", resolve: resolveEmpty, spawnFn: fakeSpawn({ calls: [] }), probe: async () => true })
  const status = await s.start(3000)
  assert.equal(status.state, "crashed")
  assert.match(status.error, /no start command/)
})

test("start without any exposed port errors", async () => {
  const s = new Supervisor({ workdir: "/w", resolve: resolveOk, spawnFn: fakeSpawn({ calls: [] }), probe: async () => true })
  const status = await s.start()
  assert.match(status.error, /no port/)
})

test("a managed child exit flips state to crashed without throwing", async () => {
  const rec = { calls: [] }
  const s = new Supervisor({ workdir: "/w", resolve: resolveOk, spawnFn: fakeSpawn(rec), probe: async () => true })
  await s.start(3000)
  rec.calls[0].emitExit(1)
  assert.equal(s.statusSync().state, "crashed")
  assert.match(s.statusSync().error, /exited/)
})

test("restart refuses when the app was never managed", async () => {
  const s = new Supervisor({ workdir: "/w", resolve: resolveOk, spawnFn: fakeSpawn({ calls: [] }), probe: async () => true })
  s.expose(3000)
  const status = await s.restart()
  assert.equal(status.managed, false)
  assert.match(status.error, /not managed/)
})

test("restart re-spawns a managed app", async () => {
  const rec = { calls: [] }
  const s = new Supervisor({ workdir: "/w", resolve: resolveOk, spawnFn: fakeSpawn(rec), probe: async () => true })
  await s.start(3000)
  await s.restart()
  assert.equal(rec.calls.length, 2)
})

test("status enriches with a live listening probe", async () => {
  const s = new Supervisor({ workdir: "/w", resolve: resolveOk, spawnFn: fakeSpawn({ calls: [] }), probe: async () => true })
  s.expose(3000)
  const status = await s.status()
  assert.equal(status.listening, true)
})