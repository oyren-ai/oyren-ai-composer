// The tmux bridge: token-gated /tmux/* endpoints so workspace agents (via the orchestrator's MCP
// wrappers) can observe — and, behind a stale-pane guard, message — the agent CLIs living in tmux
// panes, without relaying through this container's primary agent. Design: workspace note
// tmux-agent-bridge-solution.md, "Minimal First Version".
//
//   GET  /tmux/panes                  → every pane on the server, normalized + likelyAgent flag
//   GET  /tmux/panes/:id              → one pane + a short redacted screen preview: the look-first
//                                       call whose fields a caller echoes back as expected* on input
//   GET  /tmux/panes/:id/screen?lines → capture-pane text, secrets redacted (passive, always
//                                       allowed); ?raw=1 keeps wrapped lines unjoined for a
//                                       fixed-grid tile, ?ansi=1 keeps colour
//   POST /tmux/panes/:id/input        → send-keys, ONLY when the pane still matches what the caller
//                                       last observed (expectedCommand/expectedTitle required,
//                                       expectedCwd as optional extra tightening; mismatch → 409)
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
// so the parser can fold the remainder back into it. The geometry fields let a tile view size
// itself from the pane's REAL character grid (width x height x cell size) instead of resizing the
// pane — sizing the tile from the pane is what keeps the live session untouched.
const LIST_FORMAT = [
  "#{session_name}", "#{window_index}", "#{pane_index}", "#{pane_id}",
  "#{pane_current_command}", "#{pane_current_path}",
  "#{pane_width}", "#{pane_height}", "#{pane_active}", "#{window_zoomed_flag}",
  "#{pane_title}",
].join("\t")

// Commands/titles that mark a pane as "probably an agent CLI, not a bare shell/build/editor".
// The name match alone misses real agents: Claude Code launched via the pnpm shim shows
// pane_current_command "sh" and no CLI name anywhere — but it stamps its pane title with a
// leading "✳", which is exactly the signal a human uses to spot agent panes in the tab bar.
const AGENT_RE = /\b(claude|codex|opencode|gemini|dsh)\b/i
const isLikelyAgent = (command, title) => AGENT_RE.test(command) || AGENT_RE.test(title) || title.startsWith("✳")

const MAX_LINES = 5000
const DEFAULT_LINES = 200
const PREVIEW_LINES = 15
// Input text lands in a single send-keys argv; a multi-MB body would hit E2BIG/maxBuffer opaquely,
// so oversize fails crisply instead. 64KB is far beyond any sane pane message.
const MAX_TEXT_BYTES = 64 * 1024

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

// CSI (colour/cursor) and OSC (title/hyperlink) sequences — what `capture-pane -e` emits.
const ANSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
const stripAnsi = (text) => text.replace(ANSI_RE, "")

function applyPatterns(text) {
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

/**
 * Redact secret-looking content. Colour codes do not exempt anything: with `-e` capture, a token
 * can be interrupted mid-string by an SGR sequence (`ghp_abc<ESC>[0mdef…`), which walks straight
 * through a regex written for contiguous text. So each line is also checked with its escapes
 * removed, and when stripping reveals a secret the raw pass missed, that line is emitted stripped
 * and redacted — it loses its colour, never its redaction. Lines with no escapes take the plain
 * path unchanged, so this is the ONE redaction routine for every bridge output.
 */
function redactSecrets(text) {
  let count = 0
  const lines = text.split("\n").map((line) => {
    const stripped = stripAnsi(line)
    if (stripped === line) {
      const plain = applyPatterns(line)
      count += plain.count
      return plain.text
    }
    const raw = applyPatterns(line)
    // The precise question is "does a secret survive in the redacted line once escapes are gone?",
    // and the answer must be read off the TEXT, not a match count: an escape can add an overlapping
    // match that rewrites a placeholder to itself (`token: [redacted]` matches the assignment
    // pattern again and yields the same string), which a count comparison misreads as a hidden
    // secret and needlessly strips the colour off a line that was already safe.
    const afterRaw = stripAnsi(raw.text)
    if (applyPatterns(afterRaw).text !== afterRaw) {
      const bare = applyPatterns(stripped)
      count += bare.count
      return bare.text // escapes really were hiding a secret — colour is the thing we give up
    }
    count += raw.count
    return raw.text
  })
  return { text: lines.join("\n"), count }
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
      const [session, win, paneIdx, id, command, cwd, width, height, active, zoomed, ...titleParts] = line.split("\t")
      const title = titleParts.join("\t")
      return {
        id,
        target: `${session}:${win}.${paneIdx}`,
        command,
        cwd,
        title,
        // Character grid, not pixels — the consumer multiplies by its own cell size.
        width: Number(width) || 0,
        height: Number(height) || 0,
        active: active === "1",
        zoomed: zoomed === "1",
        likelyAgent: isLikelyAgent(command, title),
        // v1: every pane is raw-terminal. "structured" arrives when panes advertise a transport.
        mode: "tty",
      }
    })
}

/** "%3" (raw or url-encoded) → "%3"; null for anything else. Bare digits are deliberately
 *  rejected: pane INDEXES (the .N in a target like "main:5.1") and pane IDS (%N) are different
 *  namespaces, and silently promoting "1" to "%1" would address a different pane than the caller
 *  meant. The strict shape doubles as the safety check on what reaches `-t`. */
function paneIdOf(segment) {
  let s
  try {
    s = decodeURIComponent(segment)
  } catch {
    return null
  }
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

// The look-before-you-type call (OYR-0022): one pane's record plus a short redacted screen preview,
// so a caller (or the human it shows this to) sees command, cwd, title and what's on screen — and
// knows exactly which values to echo back as expected* on /input.
async function handlePaneDetail(req, res, paneId) {
  if (req.method !== "GET") return fail(res, 405, "method not allowed")
  let pane
  try {
    pane = (await listPanes()).find((p) => p.id === paneId)
  } catch (err) {
    return fail(res, 503, "tmux unavailable", { detail: err.message })
  }
  if (!pane) return fail(res, 404, "pane not found")
  try {
    const captured = await execImpl(["capture-pane", "-p", "-J", "-S", `-${PREVIEW_LINES}`, "-t", paneId])
    json(res, 200, { unit: tmuxUnitState(), pane, preview: redactSecrets(captured).text })
  } catch (err) {
    fail(res, 503, "capture failed", { detail: err.message })
  }
}

const isOn = (v) => v === "1" || v === "true"

async function handleScreen(req, res, paneId) {
  if (req.method !== "GET") return fail(res, 405, "method not allowed")
  const params = new URL(req.url, "http://localhost").searchParams
  const linesParam = params.get("lines")
  const lines = linesParam == null ? DEFAULT_LINES : Math.floor(Number(linesParam))
  if (!Number.isFinite(lines) || lines < 1 || lines > MAX_LINES) {
    return fail(res, 400, `lines must be an integer between 1 and ${MAX_LINES}`)
  }
  // ?raw=1 drops -J and ?ansi=1 adds -e, both opt-in because they serve a different consumer:
  //   -J joins wrapped lines, which is right for an agent reading prose and WRONG for a fixed-grid
  //     tile, where it destroys column alignment;
  //   -e keeps the colour an agent TUI paints, which otherwise arrives as flat grey text.
  // Cadence note: -e capture is materially more expensive per call than plain text, so it suits a
  // poll-only-the-visible-tiles consumer — not a background poll of every pane on the server.
  const raw = isOn(params.get("raw"))
  const ansi = isOn(params.get("ansi"))
  try {
    // -p print, -J join wrapped lines (unless raw), -e keep escapes, -S -N: N lines back in history.
    const args = ["capture-pane", "-p"]
    if (!raw) args.push("-J")
    if (ansi) args.push("-e")
    args.push("-S", `-${lines}`, "-t", paneId)
    const captured = await execImpl(args)
    // Redaction is NOT conditional on the mode — see redactSecrets: escapes never exempt a secret.
    const { text, count } = redactSecrets(captured)
    json(res, 200, { unit: tmuxUnitState(), id: paneId, lines, raw, ansi, screen: text, redactions: count })
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
  const { text, enter = false, expectedCommand, expectedTitle, expectedCwd } = body
  if (typeof text !== "string") return fail(res, 400, "text (string) is required")
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) return fail(res, 413, `text exceeds ${MAX_TEXT_BYTES} bytes`)
  // The stale-pane guard is not optional: typing into a pane nobody has looked at is exactly the
  // failure mode the design forbids. The caller proves recency by echoing what it last observed —
  // and that proof must be command or title: cwd alone is the weakest identity signal (every pane
  // in a worktree shares it, and an agent that exited to a bare shell keeps it), so expectedCwd
  // only tightens a guard, it never carries one.
  if (typeof expectedCommand !== "string" && typeof expectedTitle !== "string") {
    return fail(res, 400, "expectedCommand or expectedTitle is required (expectedCwd alone is not a pane identity)")
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
  if (typeof expectedCwd === "string" && pane.cwd !== expectedCwd) {
    return fail(res, 409, "pane changed since observed", { field: "cwd", expected: expectedCwd, actual: pane.cwd })
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
  console.log(`[tmux-bridge] input ts=${new Date().toISOString()} pane=${paneId} command=${pane.command} bytes=${Buffer.byteLength(text)} enter=${!!enter}`)
  json(res, 200, { ok: true, unit: tmuxUnitState(), pane: { id: pane.id, command: pane.command, title: pane.title } })
}

/** Single dispatch for everything under /tmux (router.js sends the whole prefix here). */
async function handleTmuxBridge(req, res) {
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" })
  const path = (req.url || "/").split("?")[0]
  const m = path.match(/^\/tmux\/panes(?:\/([^/]+)(?:\/(screen|input))?)?\/?$/)
  if (!m) return fail(res, 404, "not found")
  if (!m[1]) return handlePanes(req, res)
  const paneId = paneIdOf(m[1])
  if (!paneId) return fail(res, 400, "invalid pane id (want %N)")
  if (!m[2]) return handlePaneDetail(req, res, paneId)
  return m[2] === "screen" ? handleScreen(req, res, paneId) : handleInput(req, res, paneId)
}

module.exports = { handleTmuxBridge, redactSecrets, __setExec }
