const { test } = require("node:test")
const assert = require("node:assert/strict")
const path = require("path")
const fs = require("fs")
const os = require("os")
const { spawnSync } = require("child_process")

const SCRIPT = path.join(__dirname, "dsh-web.sh")

// `dsh` and `oyren` are stubbed: dsh prints the argv it was exec'd with, oyren logs every call. The
// real PATH stays behind the stub dir for seq/sleep/tr — only those two binaries are ours to fake.
function run(env, extra = []) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-dsh-web-"))
  const log = path.join(bin, "oyren.log")
  fs.writeFileSync(path.join(bin, "dsh"), "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", { mode: 0o755 })
  fs.writeFileSync(path.join(bin, "oyren"), `#!/bin/sh\necho "oyren $*" >> "${log}"\n`, { mode: 0o755 })
  const r = spawnSync("bash", [SCRIPT, ...extra], { env: { PATH: `${bin}:${process.env.PATH}`, ...env }, encoding: "utf8" })
  const oyren = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""
  fs.rmSync(bin, { recursive: true, force: true })
  return { args: r.stdout.split("\n").filter((l) => l && !l.startsWith("oyren-dsh-web:")), stdout: r.stdout, oyren, code: r.status }
}

const trusted = (args) => args.flatMap((a, i) => (a === "--trusted-host" ? [args[i + 1]] : []))

test("with a public origin, dsh trusts the dsh host AND the session host, and registers no route", () => {
  const { args, oyren, code } = run({ OYREN_PUBLIC_ORIGIN: "https://abc123.sandboxes.oyren.ai" })
  assert.equal(code, 0)
  assert.deepEqual(args.slice(0, 4), ["web", "--no-open", "--port", "3080"])
  assert.deepEqual(trusted(args), ["abc123.sandboxes.oyren.ai", "dsh-abc123.sandboxes.oyren.ai"])
  assert.equal(oyren, "") // OYREN_DSH_ROUTE defaults to none: "/" of the session host stays the user's app
})

test("derives the dsh host the way src/dshHost.js does: lower-cased, port dropped, 63-char label cap", () => {
  let { args } = run({ PUBLIC_URL: "https://ABC.Sandboxes.oyren.ai:8443/x" })
  assert.deepEqual(trusted(args), ["ABC.Sandboxes.oyren.ai:8443", "dsh-abc.sandboxes.oyren.ai"])
  ;({ args } = run({ SANDBOX_HOSTNAME: `${"a".repeat(60)}.edge.test` }))
  assert.deepEqual(trusted(args), [`${"a".repeat(60)}.edge.test`])
})

test("no edge domain (or no origin at all) ⇒ no dsh host: the old catch-all / route comes back", () => {
  const { args, oyren } = run({ SANDBOX_HOSTNAME: "localhost" })
  assert.deepEqual(trusted(args), ["localhost"])
  assert.match(oyren, /^oyren route add \/ 3080 DeepSeek Harness$/m)
  const bare = run({})
  assert.deepEqual(trusted(bare.args), [])
  assert.match(bare.oyren, /route add \/ 3080/)
})

test("an explicit OYREN_DSH_ROUTE still wins over both defaults", () => {
  const { oyren } = run({ OYREN_PUBLIC_ORIGIN: "https://abc123.sandboxes.oyren.ai", OYREN_DSH_ROUTE: "/dsh" })
  assert.match(oyren, /route add \/dsh 3080/)
  assert.equal(run({ SANDBOX_HOSTNAME: "localhost", OYREN_DSH_ROUTE: "none" }).oyren, "")
})

test("extra arguments are forwarded to dsh web verbatim, after the computed ones", () => {
  const { args } = run({ OYREN_PUBLIC_ORIGIN: "https://abc123.sandboxes.oyren.ai" }, ["--verbose"])
  assert.equal(args[args.length - 1], "--verbose")
})
