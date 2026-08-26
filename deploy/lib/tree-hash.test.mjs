// tree_hash is what decides whether the runtime "changed" between a droplet and a release, so it
// has to be stable across machines and blind to the things that legitimately differ between a git
// checkout and an rsynced copy (node_modules, dist, file modes).
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const LIB = join(dirname(fileURLToPath(import.meta.url)), "tree-hash.sh")

function hashOf(cwd, ...paths) {
  const r = spawnSync("bash", ["-c", `source '${LIB}'; tree_hash ${paths.map((p) => `'${p}'`).join(" ")}`], { cwd, encoding: "utf8", env: { PATH: process.env.PATH } })
  return { status: r.status, out: r.stdout.trim(), err: r.stderr }
}

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "tree-hash-"))
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return root
}

const FILES = { "runtime/src/server.js": "a", "runtime/bin/oyren": "b", "host/install-host.sh": "c" }

test("the same files in two places hash the same, and the hash has the t- shape", () => {
  const a = hashOf(tree(FILES), "runtime", "host")
  const b = hashOf(tree(FILES), "runtime", "host")
  assert.equal(a.status, 0, a.err)
  assert.match(a.out, /^t-[0-9a-f]{12}$/)
  assert.equal(a.out, b.out)
})

test("a changed byte, a renamed file, or an added file changes the hash; modes do not", () => {
  const base = hashOf(tree(FILES), "runtime", "host").out
  assert.notEqual(hashOf(tree({ ...FILES, "runtime/src/server.js": "A" }), "runtime", "host").out, base)
  assert.notEqual(hashOf(tree({ ...FILES, "runtime/src/extra.js": "z" }), "runtime", "host").out, base)
  const renamed = { "runtime/src/server2.js": "a", "runtime/bin/oyren": "b", "host/install-host.sh": "c" }
  assert.notEqual(hashOf(tree(renamed), "runtime", "host").out, base)
  const modes = tree(FILES)
  chmodSync(join(modes, "runtime/bin/oyren"), 0o755)
  assert.equal(hashOf(modes, "runtime", "host").out, base)
})

test("node_modules, dist and .git never count, so an rsynced tree hashes like the checkout", () => {
  const base = hashOf(tree(FILES), "runtime", "host").out
  const noisy = tree({ ...FILES, "runtime/node_modules/x/index.js": "n", "runtime/dist/out.js": "d", "runtime/.git/HEAD": "ref" })
  assert.equal(hashOf(noisy, "runtime", "host").out, base)
})

test("single files can be hashed too, and a missing path is an error", () => {
  const root = tree(FILES)
  const one = hashOf(root, "host/install-host.sh")
  assert.equal(one.status, 0, one.err)
  assert.match(one.out, /^t-[0-9a-f]{12}$/)
  const missing = hashOf(root, "nope")
  assert.notEqual(missing.status, 0)
  assert.match(missing.err, /no such path/)
})
