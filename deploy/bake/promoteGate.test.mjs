// The promote smoke boot's gates, pinned as text. The health check alone let a DOA oyren-tmux unit
// (the invalid `-D start-server` argv) promote into production images for four days: health only
// proves the RUNTIME booted, and terminals silently fall back to an ad-hoc in-cgroup tmux server
// when the unit is down, so nothing visible failed. The boot must now refuse an image whose tmux
// unit is anything but quietly ACTIVE.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "promote-snapshot.sh"), "utf8")

test("the smoke boot asserts the tmux unit is ACTIVE, not just that health answered", () => {
  assert.match(SCRIPT, /systemctl is-active oyren-tmux/)
})

test("the smoke boot refuses a crash-looping unit: zero automatic restarts", () => {
  assert.match(SCRIPT, /NRestarts/)
  assert.match(SCRIPT, /NRestarts=0/)
})

test("a failed tmux gate deletes the candidate like a failed health check does", () => {
  const gate = SCRIPT.slice(SCRIPT.indexOf("is-active oyren-tmux"))
  assert.match(gate, /delete_image "\$IMAGE_ID"/)
  assert.match(gate, /exit 1/)
})
