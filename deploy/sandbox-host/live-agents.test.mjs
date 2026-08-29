// live-agents.sh is the per-component path an in-place update takes for agent CLIs. What matters:
// one component means one pnpm add at the pin from deploy/versions.env with that package's own
// --allow-build (and none for antigravity-acp), the manifest is stamped as it lands, and the
// unpinned vendor installs are refused without --force.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, "live-agents.sh")
const PINS = Object.fromEntries(
  readFileSync(join(HERE, "../versions.env"), "utf8").split("\n").filter((l) => /^[A-Z]/.test(l)).map((l) => l.split("=")),
)

function run(args) {
  const root = mkdtempSync(join(tmpdir(), "live-agents-"))
  const bin = join(root, "bin")
  mkdirSync(join(root, "home"), { recursive: true })
  mkdirSync(bin)
  writeFileSync(join(bin, "pnpm"), `#!/bin/sh\necho "pnpm $*" >> "${root}/calls"\n`)
  writeFileSync(join(bin, "claude"), `#!/bin/sh\necho "${PINS.CLAUDE_VERSION} (Claude Code)"\n`)
  writeFileSync(join(bin, "timeout"), `#!/bin/sh\nshift\nexec "$@"\n`)
  writeFileSync(join(bin, "chown"), `#!/bin/sh\nexit 0\n`)
  for (const f of ["pnpm", "claude", "timeout", "chown"]) chmodSync(join(bin, f), 0o755)
  const manifest = join(root, "image-manifest.json")
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, OYREN_IMAGE_MANIFEST: manifest, SANDBOX_USER: "nobody", PNPM_HOME: join(root, "pnpm"), HOME: join(root, "home") },
  })
  let calls = ""
  try { calls = readFileSync(join(root, "calls"), "utf8") } catch {}
  let stamped = null
  try { stamped = JSON.parse(readFileSync(manifest, "utf8")) } catch {}
  return { status: r.status, out: r.stdout, err: r.stderr, calls, stamped }
}

test("one component: one pnpm add at the pin with its own --allow-build, then a stamp", () => {
  const r = run(["claude"])
  assert.equal(r.status, 0, r.err)
  assert.match(r.calls, new RegExp(`pnpm add -g --allow-build=@anthropic-ai/claude-code @anthropic-ai/claude-code@${PINS.CLAUDE_VERSION.replace(/\./g, "\\.")}`))
  assert.equal(r.stamped.components.claude, PINS.CLAUDE_VERSION)
  assert.match(r.out, /claude smoke/)
})

test("antigravity-acp installs without an --allow-build flag; several components run in order", () => {
  const r = run(["antigravityAcp", "qwen"])
  assert.equal(r.status, 0, r.err)
  const lines = r.calls.trim().split("\n")
  assert.equal(lines[0], `pnpm add -g antigravity-acp@${PINS.ANTIGRAVITY_ACP_VERSION}`)
  assert.equal(lines[1], `pnpm add -g --allow-build=@qwen-code/qwen-code @qwen-code/qwen-code@${PINS.QWEN_VERSION}`)
  assert.equal(r.stamped.components.qwen, PINS.QWEN_VERSION)
  assert.equal(r.stamped.components.antigravityAcp, PINS.ANTIGRAVITY_ACP_VERSION)
})

test("vendor installs are refused without --force, unknown components are a usage error", () => {
  const cursor = run(["cursor"])
  assert.equal(cursor.status, 3)
  assert.match(cursor.err, /no pinned version/)
  assert.equal(cursor.calls, "", "nothing was installed")
  assert.equal(run(["frobnicator"]).status, 2)
  assert.equal(run([]).status, 2)
})
