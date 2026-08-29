// A quote inside `${VAR:?word}` is NOT literal text: bash parses the word, so an apostrophe there
// opens a single-quoted string that runs on until the next one. That is how promote-snapshot.sh
// swallowed its own `USER_DATA=$(mktemp)` line and died with "USER_DATA: unbound variable" on the
// first bake that ever reached it — `bash -n` parses the file happily, so only running it or this
// check catches it.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const shellFiles = () =>
  spawnSync("git", ["ls-files", "*.sh"], { cwd: ROOT, encoding: "utf8" })
    .stdout.split("\n").filter(Boolean)

// ${NAME:?word} / ${NAME:-word} / ${NAME:+word}, capturing the word up to the closing brace.
const EXPANSION = /\$\{[A-Za-z_][A-Za-z0-9_]*:[?+-]([^}]*)\}/g

// Balanced quotes are fine (`${flag:+"$flag"}`), and so is anything inside a command substitution
// (`${SHA:-$(git ... "$DIR")}`) — the danger is a LONE quote, which runs on past the closing brace.
const strayQuote = (word) => {
  const bare = word.replace(/\$\([^)]*\)/g, "")
  return ["'", '"', "`"].some((q) => bare.split(q).length % 2 === 0)
}

test("no shell file leaves a stray quote inside a ${VAR:?...} word", () => {
  const offenders = []
  for (const file of shellFiles()) {
    readFileSync(join(ROOT, file), "utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(EXPANSION)) {
        if (strayQuote(m[1])) offenders.push(`${file}:${i + 1}  ${line.trim()}`)
      }
    })
  }
  assert.deepEqual(offenders, [], `a stray quote swallows the lines after it:\n${offenders.join("\n")}`)
})

test("promote-snapshot.sh's guards do not swallow the lines after them", () => {
  // Run the preamble up to the first real command and prove USER_DATA survived it. This is the
  // exact failure: bash -n parses the broken version fine, and only execution reveals the loss.
  const file = join(ROOT, "deploy", "bake", "promote-snapshot.sh")
  const lines = readFileSync(file, "utf8").split("\n")
  const end = lines.findIndex((l) => l.startsWith("NAME="))
  assert.ok(end > 0, "expected a NAME= line to bound the preamble")
  const preamble = lines.slice(0, end).join("\n").replace(/^source \.\/lib.*$/gm, ":")

  const r = spawnSync("bash", ["-c", `${preamble}\necho "USER_DATA=\${USER_DATA:+set} FINAL=$FINAL_NAME"`], {
    cwd: join(ROOT, "deploy", "bake"), encoding: "utf8",
    env: { PATH: process.env.PATH, IMAGE_ID: "1", FAMILY: "base", RELEASE_VERSION: "2026-01-01-0000" },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /USER_DATA=set/)
  assert.match(r.stdout, /FINAL=oyren-sandbox-base-2026-01-01-0000/)
})
