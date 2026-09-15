const { test } = require("node:test")
const assert = require("node:assert/strict")
const path = require("path")
const fs = require("fs")
const os = require("os")
const { spawnSync } = require("child_process")

const SCRIPT = path.join(__dirname, "dsh-web.sh")
const OYREN_PATCH = path.join(__dirname, "dsh-oyren-provider.patch.yml")

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
  assert.deepEqual(args.slice(0, 5), ["--profile", "web", "--no-open", "--port", "3080"])
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

test("extra arguments are forwarded to the explicit web profile verbatim, after the computed ones", () => {
  const { args } = run({ OYREN_PUBLIC_ORIGIN: "https://abc123.sandboxes.oyren.ai" }, ["--verbose"])
  assert.equal(args[args.length - 1], "--verbose")
})

test("the Oyren overlay is attached only when OYREN_API_KEY is non-empty, without putting the key in argv", () => {
  const without = run({ OYREN_PUBLIC_ORIGIN: "https://abc123.sandboxes.oyren.ai", OYREN_API_KEY: "" })
  assert.equal(without.args.includes("--patch"), false)

  const secret = "oyren-wallet-secret-must-not-leak"
  const withWallet = run({
    OYREN_PUBLIC_ORIGIN: "https://abc123.sandboxes.oyren.ai",
    OYREN_API_KEY: secret,
    OYREN_DSH_OYREN_PATCH: OYREN_PATCH,
  })
  assert.deepEqual(withWallet.args.slice(0, 4), ["--profile", "web", "--patch", OYREN_PATCH])
  assert.equal(withWallet.stdout.includes(secret), false)
  assert.deepEqual(trusted(withWallet.args), ["abc123.sandboxes.oyren.ai", "dsh-abc123.sandboxes.oyren.ai"])
})

test("the static Oyren overlay names the wallet environment reference and exactly the requested catalog", () => {
  const overlay = fs.readFileSync(OYREN_PATCH, "utf8")
  assert.match(overlay, /apiKeyEnv: OYREN_API_KEY/)
  assert.equal(overlay.includes("${OYREN_API_KEY}"), false)
  assert.match(overlay, /baseURL: https:\/\/openrouter\.ai\/api\/v1/)

  const ids = [...overlay.matchAll(/^\s+- id: (deepseek\/\S+)$/gm)].map((match) => match[1])
  assert.deepEqual(ids, [
    "deepseek/deepseek-v4.1-flash",
    "deepseek/deepseek-v4-pro-0813",
    "deepseek/deepseek-v4-flash-vision-exp",
  ])
  assert.equal((overlay.match(/contextWindow: 1048576/g) || []).length, 3)
  assert.equal((overlay.match(/input: \[text, image\]/g) || []).length, 2)
  assert.equal((overlay.match(/input: \[text\]/g) || []).length, 1)
})
