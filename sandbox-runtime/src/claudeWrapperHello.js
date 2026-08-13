// Parse + validate the wrapper's one-line protocol-v2 hello:
//   {"v":2,"argv":[...],"cwd":"...","env":{...},"pid":123}\n
// argv is the wrapper's process.argv.slice(2) — argv[0] the extension-chosen claude binary, the
// rest its flags, all spawned verbatim by the broker. env is the wrapper's FULL environment (same
// trust domain as the no-wrapper world — see claudeWrapperChild.js for why there's no allowlist).
const NEWLINE = 0x0a

/** Split one newline-terminated hello line off `buffer`. Returns:
 *    null            — no newline yet; wait for more bytes
 *    { error }       — malformed/unsupported hello (caller acks {ok:false} and hangs up)
 *    { hello, rest } — validated hello + any bytes that followed the newline (already-framed data) */
function parseHello(buffer) {
  const nl = buffer.indexOf(NEWLINE)
  if (nl === -1) return null
  const rest = buffer.subarray(nl + 1)
  let parsed
  try { parsed = JSON.parse(buffer.subarray(0, nl).toString("utf8")) } catch {
    return { error: "hello is not valid JSON" }
  }
  if (!parsed || typeof parsed !== "object") return { error: "hello must be a JSON object" }
  if (parsed.v !== 2) return { error: `unsupported hello version: ${JSON.stringify(parsed.v)}` }
  if (!Array.isArray(parsed.argv) || parsed.argv.length === 0 || !parsed.argv.every((a) => typeof a === "string")) {
    return { error: "hello.argv must be a non-empty array of strings" }
  }
  if (typeof parsed.cwd !== "string" || !parsed.cwd) return { error: "hello.cwd must be a non-empty string" }
  if (!parsed.env || typeof parsed.env !== "object" || Array.isArray(parsed.env)) {
    return { error: "hello.env must be an object" }
  }
  const hello = { v: 2, argv: parsed.argv, cwd: parsed.cwd, env: parsed.env, pid: Number(parsed.pid) || null }
  return { hello, rest }
}

/** The session id this spawn resumes, when argv carries `--resume <sid>` — used by the registry's
 *  resume-race hold: a draining child that OWNS that session may still be flushing its transcript,
 *  and spawning the resume before it finishes would read a truncated session file. */
function resumeSessionId(argv) {
  const i = argv.indexOf("--resume")
  if (i === -1) return null
  const sid = argv[i + 1]
  return sid && !sid.startsWith("-") ? sid : null
}

module.exports = { parseHello, resumeSessionId }
