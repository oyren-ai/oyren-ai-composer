const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { readContainerStats } = require("./stats")

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-stats-"))
  fs.writeFileSync(path.join(dir, "memory.current"), "536870912\n") // 512 MiB used
  fs.writeFileSync(path.join(dir, "memory.max"), "1073741824\n") // 1 GiB limit
  fs.writeFileSync(path.join(dir, "cpu.stat"), "usage_usec 1000000\nuser_usec 1\nsystem_usec 1\n")
  const net = path.join(dir, "net.dev")
  fs.writeFileSync(net, "Inter-|   Receive\n face |bytes\n  eth0: 1000 0 0 0 0 0 0 0 2000 0\n    lo: 50 0 0 0 0 0 0 0 50 0\n")
  return { dir, net }
}

test("readContainerStats reports memory %, disk, and network (excluding lo)", async () => {
  const { dir, net } = fixture()
  const s = await readContainerStats({ cgroupDir: dir, workdir: dir, netDevPath: net, intervalMs: 5 })
  assert.equal(s.memory.usedBytes, 536870912)
  assert.equal(s.memory.limitBytes, 1073741824)
  assert.equal(Math.round(s.memory.percent), 50)
  assert.equal(s.network.rxBytes, 1000) // lo is excluded
  assert.equal(s.network.txBytes, 2000)
  assert.equal(typeof s.disk.totalBytes, "number")
  assert.equal(typeof s.cpu.percent, "number")
})

test("readContainerStats treats memory.max=max as unlimited (null percent)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-stats-max-"))
  fs.writeFileSync(path.join(dir, "memory.current"), "100\n")
  fs.writeFileSync(path.join(dir, "memory.max"), "max\n")
  const s = await readContainerStats({ cgroupDir: dir, workdir: dir, netDevPath: path.join(dir, "none"), intervalMs: 5 })
  assert.equal(s.memory.usedBytes, 100)
  assert.equal(s.memory.limitBytes, null)
  assert.equal(s.memory.percent, null)
})

test("readContainerStats falls back to cgroup v1 (memory/ + cpuacct) when v2 files are absent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-stats-v1-"))
  fs.mkdirSync(path.join(dir, "memory"))
  fs.mkdirSync(path.join(dir, "cpuacct"))
  fs.writeFileSync(path.join(dir, "memory", "memory.usage_in_bytes"), "268435456\n") // 256 MiB used
  fs.writeFileSync(path.join(dir, "memory", "memory.limit_in_bytes"), "1073741824\n") // 1 GiB limit
  fs.writeFileSync(path.join(dir, "cpuacct", "cpuacct.usage"), "1000000000\n") // 1s in ns
  const s = await readContainerStats({ cgroupDir: dir, workdir: dir, netDevPath: path.join(dir, "none"), intervalMs: 5 })
  assert.equal(s.memory.usedBytes, 268435456)
  assert.equal(s.memory.limitBytes, 1073741824)
  assert.equal(Math.round(s.memory.percent), 25)
  assert.equal(typeof s.cpu.percent, "number")
})

test("readContainerStats treats the cgroup v1 unlimited sentinel as no limit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-stats-v1max-"))
  fs.mkdirSync(path.join(dir, "memory"))
  fs.writeFileSync(path.join(dir, "memory", "memory.usage_in_bytes"), "100\n")
  fs.writeFileSync(path.join(dir, "memory", "memory.limit_in_bytes"), "9223372036854771712\n")
  const s = await readContainerStats({ cgroupDir: dir, workdir: dir, netDevPath: path.join(dir, "none"), intervalMs: 5 })
  assert.equal(s.memory.usedBytes, 100)
  assert.equal(s.memory.limitBytes, null)
  assert.equal(s.memory.percent, null)
})

test("readContainerStats degrades to nulls/zeros when sources are missing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-stats-empty-"))
  const s = await readContainerStats({ cgroupDir: path.join(dir, "nope"), workdir: dir, netDevPath: path.join(dir, "none"), intervalMs: 5 })
  assert.equal(s.memory.usedBytes, null)
  assert.equal(s.memory.percent, null)
  assert.equal(s.cpu.percent, null)
  assert.equal(s.network.rxBytes, 0)
})
