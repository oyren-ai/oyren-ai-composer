// Resource stats for the running container, read from cgroup (v2 OR v1) + /proc (display-only;
// never billed). Paths are injectable so they're unit-testable without a real cgroup mount. Any
// unreadable source degrades to null rather than throwing — a stats read must never take the
// control API down. DO App Platform mounts cgroup v1, so we try v2's unified files first and fall
// back to v1's `memory/` + `cpu*/` hierarchies (otherwise memory/CPU silently read as null there).
const fsp = require("fs/promises")

// v1's "unlimited" sentinel (~9.2e18 = LONG_MAX page-aligned). Treat any absurd limit as "no limit".
const UNLIMITED = 1e18

async function readNum(p) {
  try { return Number((await fsp.readFile(p, "utf8")).trim()) } catch { return null }
}

async function readMemory(cg) {
  // v2: memory.current / memory.max ("max" = unlimited). v1: memory/memory.usage_in_bytes / .limit_in_bytes.
  let usedBytes = await readNum(`${cg}/memory.current`)
  let raw = await fsp.readFile(`${cg}/memory.max`, "utf8").then((s) => s.trim()).catch(() => null)
  if (usedBytes == null) usedBytes = await readNum(`${cg}/memory/memory.usage_in_bytes`)
  if (raw == null) raw = await fsp.readFile(`${cg}/memory/memory.limit_in_bytes`, "utf8").then((s) => s.trim()).catch(() => null)
  const n = raw && raw !== "max" ? Number(raw) : null
  const limitBytes = n != null && n < UNLIMITED ? n : null
  const percent = usedBytes != null && limitBytes ? (usedBytes / limitBytes) * 100 : null
  return { usedBytes, limitBytes, percent }
}

async function cpuUsageUsec(cg) {
  // v2: cpu.stat → usage_usec (microseconds).
  const stat = await fsp.readFile(`${cg}/cpu.stat`, "utf8").catch(() => "")
  const m = stat.match(/usage_usec\s+(\d+)/)
  if (m) return Number(m[1])
  // v1: cpuacct.usage is cumulative nanoseconds (try both common mount names) → convert to µs.
  for (const p of [`${cg}/cpuacct/cpuacct.usage`, `${cg}/cpu,cpuacct/cpuacct.usage`]) {
    const ns = await readNum(p)
    if (ns != null) return ns / 1000
  }
  return null
}

// CPU% of one core over a short sampling window (cgroup gives cumulative usage, not a rate).
async function readCpuPercent(cg, intervalMs) {
  const a = await cpuUsageUsec(cg)
  if (a == null) return null
  await new Promise((r) => setTimeout(r, intervalMs))
  const b = await cpuUsageUsec(cg)
  if (b == null) return null
  return Math.max(0, ((b - a) / (intervalMs * 1000)) * 100)
}

async function readDisk(workdir) {
  try {
    const st = await fsp.statfs(workdir)
    return { usedBytes: (st.blocks - st.bfree) * st.bsize, totalBytes: st.blocks * st.bsize }
  } catch { return { usedBytes: null, totalBytes: null } }
}

async function readNetwork(netDevPath) {
  const dev = await fsp.readFile(netDevPath, "utf8").catch(() => "")
  let rxBytes = 0, txBytes = 0
  for (const line of dev.split("\n").slice(2)) {
    const m = line.trim().match(/^([^:]+):\s+(.*)$/)
    if (!m || m[1].trim() === "lo") continue
    const cols = m[2].trim().split(/\s+/)
    rxBytes += Number(cols[0]) || 0
    txBytes += Number(cols[8]) || 0
  }
  return { rxBytes, txBytes }
}

async function readContainerStats(opts = {}) {
  const cg = opts.cgroupDir || "/sys/fs/cgroup"
  const workdir = opts.workdir || process.env.WORKDIR || "/workspace"
  const netDevPath = opts.netDevPath || "/proc/self/net/dev"
  const intervalMs = opts.intervalMs || 120
  const [cpu, memory, disk, network] = await Promise.all([
    readCpuPercent(cg, intervalMs), readMemory(cg), readDisk(workdir), readNetwork(netDevPath),
  ])
  return { cpu: { percent: cpu }, memory, disk, network }
}

module.exports = { readContainerStats }
