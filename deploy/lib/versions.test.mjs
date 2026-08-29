// deploy/lib/versions.sh is what every installer trusts for its pins, so the two behaviours that
// matter are: the file's values reach the environment, and a value already in the environment wins.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const LIB = join(dirname(fileURLToPath(import.meta.url)), "versions.sh")

function run(script, env = {}) {
  return spawnSync("bash", ["-c", `source '${LIB}'; ${script}`], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } })
}

const envFile = (text) => {
  const file = join(mkdtempSync(join(tmpdir(), "versions-")), "versions.env")
  writeFileSync(file, text)
  return file
}

test("exports every pin from the file", () => {
  const file = envFile("# pins\nCLAUDE_VERSION=2.1.235\nBUN_VERSION=bun-v1.3.14 # comment\n\n")
  const r = run(`load_versions '${file}' && echo "$CLAUDE_VERSION $BUN_VERSION"`)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), "2.1.235 bun-v1.3.14")
})

test("an exported variable wins over the file, as the old per-script defaults did", () => {
  const file = envFile("CLAUDE_VERSION=2.1.235\nCODEX_VERSION=0.142.0\n")
  const r = run(`load_versions '${file}' && echo "$CLAUDE_VERSION $CODEX_VERSION"`, { CLAUDE_VERSION: "9.9.9" })
  assert.equal(r.stdout.trim(), "9.9.9 0.142.0")
})

test("defaults to deploy/versions.env next to the lib and finds the real pins", () => {
  const r = run(`load_versions && echo "$PNPM_VERSION $UPDATER_PROTOCOL"`)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+ \d+$/)
})

test("a malformed line or a missing file fails loudly instead of installing unpinned", () => {
  assert.equal(run(`load_versions '${envFile("claude=1\n")}'`).status, 1)
  assert.equal(run(`load_versions '${envFile("JUSTAKEY\n")}'`).status, 1)
  const missing = run("load_versions /nonexistent/versions.env")
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /versions file not found/)
})
