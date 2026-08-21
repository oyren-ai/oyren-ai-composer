// Tests for the xclip DISPLAY shim (xclip-shim).
//
// BEHAVIOURAL: each test runs the real shell script against a fake `xclip` that reports which
// DISPLAY it was invoked with and can be told which displays have a server answering. That is the
// whole contract — the shim's only job is to hand the real binary a live DISPLAY when the agent
// that spawned it had none, and otherwise to get out of the way.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const SHIM = fileURLToPath(new URL("./xclip-shim", import.meta.url))

/**
 * A stand-in for /usr/bin/xclip. The TARGETS probe the shim uses to test a display succeeds only
 * for displays named in $LIVE (mimicking a live X server vs. a stale socket); any other invocation
 * prints the DISPLAY it saw plus its argv, which is what the assertions read.
 */
const FAKE_XCLIP = `#!/bin/sh
# The TARGETS branch models an UNOWNED selection when \$EMPTY_CLIPBOARD is set: real xclip exits 1
# with "target TARGETS not available" there, on a display that is perfectly alive.
if [ "$1" = "-selection" ] && [ "$3" = "-t" ] && [ "$4" = "TARGETS" ]; then
  [ -z "\${EMPTY_CLIPBOARD:-}" ] || exit 1
  case " $LIVE " in *" \${DISPLAY:-none} "*) echo "TARGETS"; exit 0 ;; esac
  exit 1
fi
echo "DISPLAY=\${DISPLAY:-none} ARGS=$*"
`

/** Stands in for xdotool: asks the SERVER, so it answers regardless of who owns a selection. */
const FAKE_XDOTOOL = `#!/bin/sh
case " $LIVE " in *" \${DISPLAY:-none} "*) echo "1480 566"; exit 0 ;; esac
exit 1
`

/** Build a sandbox: a fake xclip, plus an X11 socket dir seeded with `sockets` (e.g. [":91"]). */
const sandbox = (sockets = []) => {
  const dir = mkdtempSync(join(tmpdir(), "xclip-shim-"))
  const fake = join(dir, "xclip")
  writeFileSync(fake, FAKE_XCLIP)
  chmodSync(fake, 0o755)
  const xdo = join(dir, "xdotool")
  writeFileSync(xdo, FAKE_XDOTOOL)
  chmodSync(xdo, 0o755)
  const x11 = join(dir, "X11-unix")
  mkdirSync(x11)
  for (const s of sockets) writeFileSync(join(x11, `X${s.slice(1)}`), "")
  return { dir, fake, xdo, x11 }
}

/** Run the shim. `live` lists displays with a server answering; `display` presets $DISPLAY. */
const run = ({ live = "", display, sockets = [], args = ["-selection", "clipboard", "-o"], emptyClipboard = false, noXdotool = false }) => {
  const box = sandbox(sockets)
  try {
    const env = {
      PATH: "/usr/bin:/bin",
      LIVE: live,
      XCLIP_SHIM_REAL: box.fake,
      XCLIP_SHIM_X11_DIR: box.x11,
      XCLIP_SHIM_XDOTOOL: noXdotool ? join(box.dir, "no-xdotool") : box.xdo,
    }
    if (emptyClipboard) env.EMPTY_CLIPBOARD = "1"
    if (display !== undefined) env.DISPLAY = display
    return execFileSync("/bin/sh", [SHIM, ...args], { env, encoding: "utf8" }).trim()
  } finally {
    rmSync(box.dir, { recursive: true, force: true })
  }
}

test("the bug: with no DISPLAY and no shim, xclip sees nothing — the shim supplies :90", () => {
  const out = run({ live: ":90" })
  assert.match(out, /DISPLAY=:90/)
})

test("an existing DISPLAY is never overridden, even when :90 is also live", () => {
  const out = run({ live: ":90 :77", display: ":77" })
  assert.match(out, /DISPLAY=:77/)
})

test("a stale socket is skipped for a display that actually answers", () => {
  // X91's socket file exists but nothing serves it; :90 is down, so :91 must NOT be chosen.
  const out = run({ live: ":92", sockets: [":91", ":92"] })
  assert.match(out, /DISPLAY=:92/)
})

test("the Zed display wins over other live sockets — it is the desktop the user sees", () => {
  const out = run({ live: ":90 :91", sockets: [":91"] })
  assert.match(out, /DISPLAY=:90/)
})

test("arguments reach the real binary verbatim", () => {
  const out = run({ live: ":90", args: ["-selection", "clipboard", "-t", "image/png", "-o"] })
  assert.match(out, /ARGS=-selection clipboard -t image\/png -o/)
})

test("no live display: still execs the real binary rather than failing on its own", () => {
  // Whatever xclip's own error is, it must be the one the agent sees — the shim adds no new mode.
  const out = run({ live: "" })
  assert.match(out, /DISPLAY=none/)
})

test("a missing real xclip fails loudly instead of re-entering the shim", () => {
  let threw
  try {
    execFileSync("/bin/sh", [SHIM, "-o"], {
      env: { PATH: "/usr/bin:/bin", XCLIP_SHIM_REAL: "/nonexistent/xclip" },
      encoding: "utf8",
    })
  } catch (e) {
    threw = e
  }
  assert.equal(threw?.status, 127)
  assert.match(String(threw?.stderr), /real xclip missing/)
})

test("the regression: an EMPTY clipboard must not read as a dead display", () => {
  // The first probe was `xclip -t TARGETS -o`, which exits 1 on an unowned selection. That made a
  // healthy :90 with nothing copied yet look dead, so the shim left DISPLAY unset and every
  // clipboard read failed with "Can't open display".
  const out = run({ live: ":90", emptyClipboard: true })
  assert.match(out, /DISPLAY=:90/)
})

test("without xdotool it still resolves a display that owns a selection", () => {
  const out = run({ live: ":90", noXdotool: true })
  assert.match(out, /DISPLAY=:90/)
})
