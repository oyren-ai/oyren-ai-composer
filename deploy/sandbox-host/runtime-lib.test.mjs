// runtime-lib.sh is what makes a runtime update safe on a live machine: the flip must never leave
// /app missing or pointing at a half-copied tree, an old real /app must be moved aside rather than
// deleted, staging must refuse to overwrite the active tree, and pruning must keep a rollback target.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const LIB = join(dirname(fileURLToPath(import.meta.url)), "runtime-lib.sh")

/** Run `fn` inside a shell that sourced the lib, with fake pnpm/node/chown on PATH. */
function sh(root, script, env = {}) {
  const bin = join(root, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "pnpm"), `#!/bin/sh\necho "pnpm $*" >> "${root}/calls"\nmkdir -p node_modules\n`)
  writeFileSync(join(bin, "node"), `#!/bin/sh\necho "node $*" >> "${root}/calls"\n`)
  writeFileSync(join(bin, "chown"), `#!/bin/sh\necho "chown $*" >> "${root}/calls"\n`)
  for (const f of ["pnpm", "node", "chown"]) chmodSync(join(bin, f), 0o755)
  const r = spawnSync("bash", ["-c", `source '${LIB}'; ${script}`], {
    cwd: root, encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, APP_LINK: join(root, "app"), SANDBOX_USER: env.SANDBOX_USER ?? spawnSync("id", ["-un"], { encoding: "utf8" }).stdout.trim(), ...env },
  })
  return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }
}

function tree(root, name, files = { "src/server.js": "x", "node_modules/left/over.js": "y" }) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name, rel)), { recursive: true })
    writeFileSync(join(root, name, rel), content)
  }
  return join(root, name)
}

test("activate_runtime flips /app atomically and moves a real directory aside once", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-lib-"))
  mkdirSync(join(root, "runtime"))
  const a = tree(root, "runtime/a"), b = tree(root, "runtime/b")
  tree(root, "app", { "old.js": "legacy" })
  assert.equal(sh(root, `activate_runtime '${a}'`).status, 0)
  assert.equal(readlinkSync(join(root, "app")), a)
  const legacy = readdirSync(join(root, "runtime")).find((n) => n.startsWith("legacy-"))
  assert.ok(legacy, "the old real /app was moved aside")
  assert.ok(existsSync(join(root, "runtime", legacy, "old.js")), "and kept intact")
  assert.equal(sh(root, `activate_runtime '${b}'`).status, 0)
  assert.equal(readlinkSync(join(root, "app")), b)
  assert.ok(!existsSync(join(root, "app.tmp." )), "no temp link left behind")
})

test("stage_runtime copies the tree, drops stale node_modules, installs, checks node-pty, merges skills", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-lib-"))
  const src = tree(root, "src-tree")
  mkdirSync(join(root, "skills/lean"), { recursive: true })
  writeFileSync(join(root, "skills/lean/SKILL.md"), "lean skill")
  const dest = join(root, "runtime/t-1")
  const r = sh(root, `stage_runtime '${src}' '${dest}' '${join(root, "skills")}'`)
  assert.equal(r.status, 0, r.err)
  assert.ok(existsSync(join(dest, "src/server.js")))
  assert.ok(!existsSync(join(dest, "node_modules/left/over.js")), "the source's node_modules never ride along")
  assert.ok(existsSync(join(dest, "skills/lean/SKILL.md")), "lean skills merged into the new tree")
  const calls = spawnSync("cat", [join(root, "calls")], { encoding: "utf8" }).stdout
  assert.match(calls, /pnpm install --prod --frozen-lockfile/)
  assert.match(calls, /node -e require\("node-pty"\)/)
})

test("stage_runtime refuses to stage over the active tree", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-lib-"))
  const src = tree(root, "src-tree")
  const dest = tree(root, "runtime/t-1")
  assert.equal(sh(root, `activate_runtime '${dest}'`).status, 0)
  const r = sh(root, `stage_runtime '${src}' '${dest}'`)
  assert.notEqual(r.status, 0)
  assert.match(r.err, /active runtime/)
  assert.ok(existsSync(join(dest, "src/server.js")), "nothing was deleted")
})

test("prune_runtimes keeps the current tree and the newest other one", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-lib-"))
  const names = ["t-old", "t-mid", "t-new"]
  for (const [i, n] of names.entries()) {
    tree(root, `runtime/${n}`)
    const t = new Date(Date.now() - (3 - i) * 60_000)
    spawnSync("touch", ["-t", t.toISOString().replace(/[-:T]/g, "").slice(0, 12), join(root, "runtime", n)])
  }
  assert.equal(sh(root, `prune_runtimes '${join(root, "runtime")}' '${join(root, "runtime/t-new")}'`).status, 0)
  assert.deepEqual(readdirSync(join(root, "runtime")).sort(), ["t-mid", "t-new"])
})
