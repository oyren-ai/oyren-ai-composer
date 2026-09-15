import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PATCHER = join(HERE, "dsh-trusted-host.mjs")

const packages = {
  "dsh-client-connection": {
    file: "lib/index.js",
    source: `
function isTrustedApiRequest() { return true }
class HostConnectionService {
  requestRejection(request) {
\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;
\t\treturn this.browserAuth.isAuthenticated(request) ? void 0 : 401;
\t}
  authorizeIndex(request, response) {
\t\treturn this.browserAuth.authorizeIndex(request, response);
\t}
}
`,
  },
  "dsh-client-ui-settings": {
    file: "lib/client.js",
    source: `function apply(ctx) {\n  const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";\n  return persistence\n}\n`,
  },
  "dsh-client-ui-settings-general": {
    file: "lib/client.js",
    source: `function apply(ctx) {\n  const documentController = ctx.remote.$host.isLoopback ? new SettingsDocumentStore(ctx, ctx.settingsScope.describe()) : void 0;\n  return documentController\n}\n`,
  },
}

function fixture(change = (source) => source) {
  const root = mkdtempSync(join(tmpdir(), "dsh-patch-layout-"))
  const files = {}
  for (const [name, entry] of Object.entries(packages)) {
    const file = join(root, `@deepseek-ai+${name}@0.1.5-rc.1`, "node_modules", "@deepseek-ai", name, entry.file)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, change(entry.source, name))
    files[name] = file
  }
  return { root, files }
}

function run(root) {
  return spawnSync(process.execPath, [PATCHER, root], { encoding: "utf8" })
}

test("patches the published 0.1.5 layout and is byte-stable on rerun", () => {
  const f = fixture()
  const first = run(f.root)
  assert.equal(first.status, 0, first.stderr)

  const connection = readFileSync(f.files["dsh-client-connection"], "utf8")
  assert.match(connection, /if \(!isTrustedApiRequest\(request, this\.trustedHosts\)\) return 403/)
  assert.match(connection, /token-gated dsh hostname is the authentication boundary/)
  assert.doesNotMatch(connection, /browserAuth\.isAuthenticated/)
  assert.match(connection, /authorizeIndex[\s\S]+isTrustedApiRequest\(request, this\.trustedHosts\)/)
  assert.match(connection, /response\.writeHead\(403/)

  const settings = readFileSync(f.files["dsh-client-ui-settings"], "utf8")
  assert.match(settings, /const persistence = "host"/)
  assert.doesNotMatch(settings, /isLoopback \? "host" : "memory"/)

  const general = readFileSync(f.files["dsh-client-ui-settings-general"], "utf8")
  assert.match(general, /const documentController = new SettingsDocumentStore/)
  assert.doesNotMatch(general, /isLoopback \? new SettingsDocumentStore/)

  const before = Object.fromEntries(Object.entries(f.files).map(([name, file]) => [name, readFileSync(file, "utf8")]))
  const second = run(f.root)
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(
    Object.fromEntries(Object.entries(f.files).map(([name, file]) => [name, readFileSync(file, "utf8")])),
    before,
  )
})

test("fails loudly and leaves a drifted upstream file untouched", () => {
  const f = fixture((source, name) => name === "dsh-client-ui-settings" ? source.replace("isLoopback", "isRemote") : source)
  const before = readFileSync(f.files["dsh-client-ui-settings"], "utf8")
  const result = run(f.root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /expected exactly one old or one patched occurrence/)
  assert.equal(readFileSync(f.files["dsh-client-ui-settings"], "utf8"), before)
})

test("fails when an expected 0.1.5 package is absent", () => {
  const f = fixture()
  rmSync(join(f.root, "@deepseek-ai+dsh-client-ui-settings-general@0.1.5-rc.1"), { recursive: true })
  const result = run(f.root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no @deepseek-ai\+dsh-client-ui-settings-general@/)
})
