const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")

const { sideEnvForKind, seedSideAuth, __reset } = require("./sideAgentAuth")

const mapB64 = (map) => Buffer.from(JSON.stringify(map), "utf8").toString("base64")

test.beforeEach(() => __reset())

test("sideEnvForKind overlays only the requested kind's vars", () => {
  const base = { PATH: "/bin", AGENT_SIDE_AUTH_B64: mapB64({ "qwen-code": { OPENAI_API_KEY: "or-key" }, "codex-cli": { OPENAI_API_KEY: "native" } }) }
  const qwen = sideEnvForKind("qwen-code", base)
  assert.equal(qwen.OPENAI_API_KEY, "or-key")
  assert.equal(qwen.PATH, "/bin")
  assert.equal(sideEnvForKind("codex-cli", base).OPENAI_API_KEY, "native")
  assert.equal(sideEnvForKind("cursor-cli", base).OPENAI_API_KEY, undefined)
})

test("absent or malformed AGENT_SIDE_AUTH_B64 leaves the env untouched", () => {
  assert.equal(sideEnvForKind("qwen-code", { PATH: "/bin" }).OPENAI_API_KEY, undefined)
  __reset()
  assert.equal(sideEnvForKind("qwen-code", { AGENT_SIDE_AUTH_B64: "not-base64!!" }).OPENAI_API_KEY, undefined)
})

test("seedSideAuth writes one kind's files once, from its overlaid env", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "side-auth-"))
  const prevHome = process.env.HOME
  process.env.HOME = home
  try {
    const auth = JSON.stringify({ tokens: "x" })
    const base = { AGENT_SIDE_AUTH_B64: mapB64({ "codex-cli": { CODEX_AUTH_JSON_B64: Buffer.from(auth).toString("base64") } }) }
    seedSideAuth("codex-cli", base)
    assert.equal(fs.readFileSync(path.join(home, ".codex", "auth.json"), "utf8"), auth)
    fs.rmSync(path.join(home, ".codex", "auth.json"))
    seedSideAuth("codex-cli", base) // second call is a no-op: the file must NOT come back
    assert.equal(fs.existsSync(path.join(home, ".codex", "auth.json")), false)
    seedSideAuth("cursor-cli", base) // env-only kind with no entry: silent no-op
  } finally {
    process.env.HOME = prevHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})
