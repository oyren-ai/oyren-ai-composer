const fs = require("fs")
const path = require("path")

/** Tools that can raise a permission dialog. A bare tool name allows every use of it. */
const ALWAYS_ALLOW = ["Bash", "Edit", "Write", "WebFetch", "WebSearch"]

/**
 * Seed ~/.claude/settings.json so the first (and every) interactive `claude` boots in
 * bypassPermissions mode and never asks for a tool-use permission — the whole point of an
 * autonomous, leave-it-alone sandbox. TWO keys are required, not one:
 *  - permissions.defaultMode: "bypassPermissions" — the session permission mode Claude reads
 *    from userSettings.
 *  - skipDangerousModePermissionPrompt: true — without an acceptance flag Claude SILENTLY
 *    downgrades bypassPermissions back to "default" ("bypass/auto requires accepting the
 *    disclaimer interactively first"), which an unattended container can't click through. This
 *    key suppresses that disclaimer so the mode actually sticks.
 * Bypass mode requires a non-root user (satisfied by dropping to `oyren` via runuser at launch), BUT
 * that alone is not enough: `oyren` has passwordless (NOPASSWD:ALL) sudo, and Claude Code 2.1.191's
 * guard also refuses bypass when the user can escalate to root that way ("cannot be used with root/sudo
 * privileges"). `IS_SANDBOX=1` is what makes bypass actually stick — it must reach the PROCESS env, so
 * the droplet carries it in /etc/oyren/host.env (systemd EnvironmentFile) as well as /etc/profile.d,
 * which only login shells read. The editor and the runtime are both units, not login shells.
 *
 * The allow-list is the belt to that pair of braces. Allow rules are honoured in "default" mode too,
 * so if a future Claude Code tightens the bypass guard again and downgrades us, the tools that
 * actually prompt still run unattended instead of hanging on a dialog nobody is there to click.
 * Only prompting tools are listed — Read/Glob/Grep never ask, so naming them would be noise.
 *
 * Unconditional (no env gate) so it applies in both auth paths — OAuth setup-token AND the
 * ANTHROPIC_BASE_URL (OpenRouter / z.ai) override. Idempotent + best-effort: merges into any
 * existing settings.json (never clobbers other keys), and a read/write failure must never crash
 * container boot (the caller swallows throws).
 */
function seedClaudeSettings({ home = process.env.HOME || "/home/oyren" } = {}) {
  const dir = path.join(home, ".claude")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "settings.json")

  let current = {}
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8")) || {}
  } catch {
    current = {} // no file yet (or unreadable) → start fresh
  }

  // Union, not replace: a session may have its own rules (from a repo's settings, or a previous
  // seed), and re-seeding on every boot must not grow the list.
  const allow = Array.isArray(current.permissions && current.permissions.allow) ? [...current.permissions.allow] : []
  for (const rule of ALWAYS_ALLOW) if (!allow.includes(rule)) allow.push(rule)

  const permissions = { ...(current.permissions || {}), defaultMode: "bypassPermissions", allow }
  const next = { ...current, permissions, skipDangerousModePermissionPrompt: true }
  fs.writeFileSync(file, JSON.stringify(next, null, 2))
  return true
}

module.exports = { seedClaudeSettings }
