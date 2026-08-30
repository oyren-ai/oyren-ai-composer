// The bash history block runtime-helpers.sh appends to /etc/bash.bashrc, executed for real under
// an interactive bash with a scratch HOME. It exists because nothing configured history at all: a
// killed tmux server (the 2026-08-30 incident) lost every pane's in-memory history, since bash
// writes the file only on a clean exit.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, mkdtempSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HELPERS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "runtime-helpers.sh"), "utf8")

function historyBlock() {
  const start = HELPERS.indexOf("cat >> /etc/bash.bashrc <<'HIST'")
  assert.notEqual(start, -1, "the OYREN_HISTORY heredoc moved: this test is now testing nothing")
  const body = HELPERS.slice(start + "cat >> /etc/bash.bashrc <<'HIST'\n".length)
  return body.slice(0, body.indexOf("\nHIST\n"))
}

const runInteractive = (script, env = {}) =>
  spawnSync("bash", ["-ic", script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), "oyren-hist-")), PS1: "$ ", ...env },
  })

test("every prompt appends to the history file, with dedup and timestamps on", () => {
  const out = runInteractive(`${historyBlock()}
shopt histappend | grep -q on && echo HISTAPPEND_ON
case ";$PROMPT_COMMAND;" in *"history -a"*) echo APPENDS_PER_PROMPT ;; esac
[ "$HISTCONTROL" = ignoreboth ] && echo DEDUP
[ -n "$HISTTIMEFORMAT" ] && echo STAMPED`)
  for (const marker of ["HISTAPPEND_ON", "APPENDS_PER_PROMPT", "DEDUP", "STAMPED"]) {
    assert.match(out.stdout, new RegExp(marker), out.stderr)
  }
})

test("an existing PROMPT_COMMAND is composed with, never replaced", () => {
  const out = runInteractive(`PROMPT_COMMAND='echo keepme'
${historyBlock()}
printf '%s' "$PROMPT_COMMAND"`)
  assert.match(out.stdout, /history -a;echo keepme/)
})

test("a shell that already appends is left alone rather than appending twice", () => {
  const out = runInteractive(`PROMPT_COMMAND='history -a'
${historyBlock()}
printf '%s' "$PROMPT_COMMAND"`)
  assert.equal(out.stdout.trim().split("history -a").length - 1, 1)
})
