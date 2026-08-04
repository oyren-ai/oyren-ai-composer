const fs = require("fs")
const path = require("path")

/**
 * Seed ~/.cursor/cli-config.json so interactive `cursor-agent` / `agent` boots without tool-approval
 * prompts — the Cursor analog of seedClaudeSettings' bypassPermissions. THREE keys matter:
 *  - approvalMode: "unrestricted" — Run Everything (same as --force / --yolo); without this the CLI
 *    hangs on Shell/Write approvals that an unattended container can't click through.
 *  - sandbox.mode: "disabled" — the oyren container is already the isolation boundary; Cursor's own
 *    nested sandbox can break network/tools in DO/Modal runtimes that lack the userns chromium needs.
 *  - permissions.allow — broad allowlist so allowlist-mode leftovers (or a CLI that still consults
 *    permissions under unrestricted) never prompt; deny stays empty.
 *
 * Required schema fields (version / editor.vimMode / permissions) are filled so a fresh file is valid
 * even before the CLI self-repairs. Idempotent + best-effort: merges into any existing config (never
 * clobbers unrelated keys), and a read/write failure must never crash container boot.
 */
function seedCursorSettings({ home = process.env.HOME || "/home/oyren" } = {}) {
  const dir = path.join(home, ".cursor")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "cli-config.json")

  let current = {}
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8")) || {}
  } catch {
    current = {}
  }

  const allow = Array.isArray(current.permissions && current.permissions.allow)
    ? current.permissions.allow
    : []
  const deny = Array.isArray(current.permissions && current.permissions.deny)
    ? current.permissions.deny
    : []
  // Ensure the broad patterns are present without duplicating on re-run.
  for (const p of ["Shell(**)", "Read(**)", "Write(**)", "WebFetch(*)", "Mcp(*:*)"]) {
    if (!allow.includes(p)) allow.push(p)
  }

  const next = {
    ...current,
    version: typeof current.version === "number" ? current.version : 1,
    editor: { ...(current.editor || {}), vimMode: (current.editor && current.editor.vimMode) || false },
    permissions: { ...(current.permissions || {}), allow, deny },
    approvalMode: "unrestricted",
    sandbox: { ...(current.sandbox || {}), mode: "disabled" },
  }
  fs.writeFileSync(file, JSON.stringify(next, null, 2))
  return true
}

module.exports = { seedCursorSettings }
