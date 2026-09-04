// The tmux bridge: token-gated /tmux/* endpoints so workspace agents (via the orchestrator's MCP
// wrappers) can observe — and, behind a stale-pane guard, message — the agent CLIs living in tmux
// panes, without relaying through this container's primary agent. Design: workspace note
// tmux-agent-bridge-solution.md, "Minimal First Version".
//
//   GET  /tmux/panes                  → every pane on the server, normalized + likelyAgent flag
//   GET  /tmux/panes/:id/screen?lines → capture-pane text, secrets redacted (passive, always allowed)
//   POST /tmux/panes/:id/input        → send-keys, ONLY when the pane still matches what the caller
//                                       last observed (expectedCommand/expectedTitle, else 409)
//
// All three are SESSION_TOKEN gated like /agent/*. Every response carries the oyren-tmux unit state
// (tmuxUnit.js): panes normally live in the systemd unit's server, and "the unit is dead so you're
// looking at an ad-hoc server that dies with this runtime" must be visible to remote callers, who
// have no journal access. Input events are logged as metadata only (pane, command, byte count) —
// never the text itself, which may quote prompts or secrets.
const { execFile } = require("child_process")
const { json, tokenOk, readBody } = require("./agentHttp")
const { tmuxUnitState } = require("./tmuxUnit")

// One line per pane, real tab separated (JS "\t" is a literal tab byte in the argv — tmux formats
// have no escape syntax). pane_title is LAST: it is the only field that can itself contain a tab,
// so the parser can fold the remainder back into it.
const LIST_FORMAT = ["#{session_name}", "#{window_index}", "#{pane_index}", "#{pane_id}", "#{pane_current_command}", "#{pane_current_path}", "#{pane_title}"].join("\t")

// Commands/titles that mark a pane as "probably an agent CLI, not a bare shell/build/editor".
const AGENT_RE = /\b(claude|codex|opencode|gemini|dsh)\b/i

const MAX_LINES = 5000
const DEFAULT_LINES = 200

// What a leaked credential looks like on a screen: provider token prefixes, AWS key ids, JWTs,
// Bearer headers, and `password=`/`token:`-style assignments. Replacement keeps the surrounding
// text (and the key name for assignments) so the reader still understands the screen.
const SECRET_PATTERNS = [
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, "[redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, "[redacted]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[redacted]"],
  [/\b((?:password|passwd|secret|api[_-]?key|access[_-]?key|token)\s*[=:]\s*)(\S{6,})/gi, "$1[redacted]"],
]

function redactSecrets(text) {
  let count = 0
  let out = text
  for (const [re, replacement] of SECRET_PATTERNS) {
    out = out.replace(re, (_match, group1) => {
      count++
      // "$1" in a replacement keeps that pattern's captured prefix (key name, "Bearer ").
      return replacement.includes("$1") ? replacement.replace("$1", group1) : replacement
    })
  }
  return { text: out, count }
}

// Injectable tmux runner (same seam style as tmuxUnit.js): tests swap it for a recorder.
let execImpl = (args) =>
  new Promise((resolve, reject) => {
    execFile("tmux", args, { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error(String(stderr || err.message).trim()), { cause: err }))
      else resolve(String(stdout))
    })
  })
function __setExec(fn) { execImpl = fn }

async function listPanes() {
  const out = await execImpl(["list-panes", "-a", "-F", LIST_FORMAT])
  return out
    .split("\n")
    .filter((l) => l.length)
    .map((line) => {
      const [session, win, paneIdx, id, command, cwd, ...titleParts] = line.split("\t")
      const title = titleParts.join("\t")
      return {
        id,
        target: `${session}:${win}.${paneIdx}`,
        command,
        cwd,
        title,
        likelyAgent: AGENT_RE.test(command) || AGENT_RE.test(title),
        // v1: every pane is raw-terminal. "structured" arrives when panes advertise a transport.
        mode: "tty",
      }
    })
}

/** "%3" | "3" | url-encoded variants → "%3"; null for anything that isn't a tmux pane id. The
 *  strict shape doubles as the safety check on what reaches `-t`. */
function paneIdOf(segment) {
  let s
  try {
    s = decodeURIComponent(segment)
  } catch {
    return null
  }
  if (/^\d+$/.test(s)) s = `%${s}`
  return /^%\d+$/.test(s) ? s : null
}

function fail(res, status, error, extra = {}) {
  json(res, status, { error, unit: tmuxUnitState(), ...extra })
}

async function handlePanes(req, res) {
  if (req.method !== "GET") return fail(res, 405, "method not allowed")
  try {
    json(res, 200, { unit: tmuxUnitState(), panes: await listPanes() })
  } catch (err) {
    fail(res, 503, "tmux unavailable", { detail: err.message })
  }
}

async function handleScreen(req, res, paneId) {
  if (req.method !== "GET") return fail(res, 405, "method not allowed")
  const raw = new URL(req.url, "http://localhost").searchParams.get("lines")
  const lines = raw == null ? DEFAULT_LINES : Math.floor(Number(raw))
  if (!Number.isFinite(lines) || lines < 1 || lines > MAX_LINES) {
    return fail(res, 400, `lines must be an integer between 1 and ${MAX_LINES}`)
  }
  try {
    // -p print, -J join wrapped lines, -S -N: start N lines back into history.
    const captured = await execImpl(["capture-pane", "-p", "-J", "-S", `-${lines}`, "-t", paneId])
    const { text, count } = redactSecrets(captured)
    json(res, 200, { unit: tmuxUnitState(), id: paneId, lines, screen: text, redactions: count })
  } catch (err) {
    fail(res, /can't find pane|no such pane/i.test(err.message) ? 404 : 503, "capture failed", { detail: err.message })
  }
}

async function handleInput(req, res, paneId) {
  if (req.method !== "POST") return fail(res, 405, "method not allowed")
  let body
  try {
    body = JSON.parse((await readBody(req)).toString("utf8") || "{}")
  } catch {
    return fail(res, 400, "body must be JSON")
  }
  const { text, enter = false, expectedCommand, expectedTitle } = body
  if (typeof text !== "string") return fail(res, 400, "text (string) is required")
  // The stale-pane guard is not optional: typing into a pane nobody has looked at is exactly the
  // failure mode the design forbids. The caller proves recency by echoing what it last observed.
  if (typeof expectedCommand !== "string" && typeof expectedTitle !== "string") {
    return fail(res, 400, "expectedCommand or expectedTitle is required (pass what you last observed)")
  }

  let pane
  try {
    pane = (await listPanes()).find((p) => p.id === paneId)
  } catch (err) {
    return fail(res, 503, "tmux unavailable", { detail: err.message })
  }
  if (!pane) return fail(res, 404, "pane not found")
  if (typeof expectedCommand === "string" && pane.command !== expectedCommand) {
    return fail(res, 409, "pane changed since observed", { field: "command", expected: expectedCommand, actual: pane.command })
  }
  if (typeof expectedTitle === "string" && pane.title !== expectedTitle) {
    return fail(res, 409, "pane changed since observed", { field: "title", expected: expectedTitle, actual: pane.title })
  }

  try {
    // -l: literal keystrokes (so "Enter"/"C-c" in the text are typed, not interpreted); -- ends
    // option parsing (text may start with "-"). The Enter keypress is its own, non-literal call.
    if (text.length) await execImpl(["send-keys", "-t", paneId, "-l", "--", text])
    if (enter) await execImpl(["send-keys", "-t", paneId, "Enter"])
  } catch (err) {
    return fail(res, 503, "send failed", { detail: err.message })
  }
  // Metadata only — the text itself is never logged.
  console.log(`[tmux-bridge] input pane=${paneId} command=${pane.command} bytes=${Buffer.byteLength(text)} enter=${!!enter}`)
  json(res, 200, { ok: true, unit: tmuxUnitState(), pane: { id: pane.id, command: pane.command, title: pane.title } })
}

/** Single dispatch for everything under /tmux (router.js sends the whole prefix here). */
async function handleTmuxBridge(req, res) {
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" })
  const path = (req.url || "/").split("?")[0]
  const m = path.match(/^\/tmux\/panes(?:\/([^/]+)\/(screen|input))?\/?$/)
  if (!m) return fail(res, 404, "not found")
  if (!m[1]) return handlePanes(req, res)
  const paneId = paneIdOf(m[1])
  if (!paneId) return fail(res, 400, "invalid pane id (want %N)")
  return m[2] === "screen" ? handleScreen(req, res, paneId) : handleInput(req, res, paneId)
}

module.exports = { handleTmuxBridge, redactSecrets, __setExec }
