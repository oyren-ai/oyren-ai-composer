// `oyren quiesce`: what the orchestrator runs before it snapshots this machine's disk, and what a
// person can run to see what that does. Stops the managed app through the control API (so the
// supervisor knows), then hands the rest (agent, caches, fstrim, cloud-init) to the root-side
// script deploy/update/oyren-quiesce.sh through its /usr/local/bin shim.
const { execFile } = require("child_process")
const { requestControl } = require("./control")

const QUIESCE_BIN = process.env.OYREN_QUIESCE_BIN || "/usr/local/bin/oyren-quiesce"

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf8", maxBuffer: 1 << 20 }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }))
  })
}

async function quiesceCommand(args, { stdout = (s) => process.stdout.write(s), exec = run, control = requestControl } = {}) {
  const json = args.includes("--json")
  try { await control("stop", {}) } catch { /* no runtime to stop is fine before a snapshot */ }
  const r = await exec("sudo", ["-n", QUIESCE_BIN, ...(json ? ["--json"] : []), ...args.filter((a) => a !== "--json")])
  stdout(r.stdout)
  if (r.code !== 0) stdout(r.stderr)
  return r.code
}

module.exports = { quiesceCommand }
