import test from "node:test"
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = readFileSync(join(HERE, "install-agents.sh"), "utf8")

/** The heredoc this script writes to /etc/profile.d/20-oyren-agents.sh — i.e. exactly what a login
 *  shell in a session ends up with. Extracted rather than executed: running the installer would
 *  apt-install half a distribution. */
function profileBlock() {
  const start = SCRIPT.indexOf("cat > /etc/profile.d/20-oyren-agents.sh <<'EOF'")
  assert.notEqual(start, -1, "the profile.d heredoc moved — this test is now testing nothing")
  const body = SCRIPT.slice(start)
  return body.slice(0, body.indexOf("\nEOF\n"))
}

// The regression this pins: these two reached ONLY the interactive TUIs (systemd units read
// host.env, and the headless agent is the in-process SDK). With mouse reporting off, tmux swallowed
// every drag into copy-mode, so inside a session you could neither click to place the cursor nor
// select text in Claude Code. They must not come back without the headless path actually needing them.
test("the login-shell profile does not disable Claude Code's TTY features", () => {
  const block = profileBlock()
  assert.doesNotMatch(block, /CLAUDE_CODE_DISABLE_MOUSE/)
  assert.doesNotMatch(block, /CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN/)
})

// Each of these earns its place in a LOGIN shell specifically, and losing one is a silent
// regression: no auto-update footer, agents that can't find chromium, a missing antigravity binary.
test("the login-shell profile still carries the env a session's agents need", () => {
  const block = profileBlock()
  for (const name of ["PLAYWRIGHT_BROWSERS_PATH", "AGY_BIN", "DISABLE_AUTOUPDATER", "IS_SANDBOX"]) {
    assert.match(block, new RegExp(`export ${name}=`), `${name} disappeared from the login profile`)
  }
})
