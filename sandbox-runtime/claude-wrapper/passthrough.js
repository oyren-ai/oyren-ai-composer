// The `exec "$@"` path: run exactly what the extension asked for, as if this wrapper didn't exist.
// Used when the flag is off AND as the fallback whenever the broker is unreachable/refusing — a
// wrapper that can't reach its broker must degrade to today's behavior, never a dead Chat panel.
const { spawn } = require("child_process")

function fatal(msg) {
  process.stderr.write(`oyren-claude-wrapper: ${msg}\n`) // stderr only — stdout belongs to claude
  process.exit(1)
}

/** Spawn argv[0] with argv.slice(1) verbatim (argv[0] is the extension-chosen claude binary — never
 *  substituted), stdio inherited so the child sees the extension's own pipes (no PTY: a TTY makes
 *  the CLI hard-fail --input-format=stream-json, and PTY echo would corrupt the NDJSON channel).
 *  `replayStdin` (optional Buffer array): stdin bytes this process already consumed before a
 *  mid-relay fallback — written to the child first, then live stdin is piped after them. */
function passthrough(argv, replayStdin) {
  if (!argv || argv.length === 0) fatal("no command given — expected: oyren-claude-wrapper <claude-binary> [args...]")
  const useReplay = Array.isArray(replayStdin) && replayStdin.length > 0
  const child = spawn(argv[0], argv.slice(1), {
    stdio: useReplay ? ["pipe", "inherit", "inherit"] : "inherit",
    shell: false,
  })
  child.on("error", (err) => fatal(`failed to exec ${argv[0]}: ${err.message}`))
  if (useReplay) {
    child.stdin.on("error", () => { /* child died first — EPIPE here is reported via its exit */ })
    for (const chunk of replayStdin) child.stdin.write(chunk)
    process.stdin.pipe(child.stdin)
  }
  // Forward the panel's signals so a close kills the real child exactly as it would without us.
  process.on("SIGTERM", () => { try { child.kill("SIGTERM") } catch { /* already gone */ } })
  process.on("SIGINT", () => { try { child.kill("SIGINT") } catch { /* already gone */ } })
  child.on("exit", (code, signal) => {
    if (signal) {
      // Mirror a signal death as a signal death (not a made-up exit code): drop our handlers so the
      // default disposition is restored, then re-raise the same signal on ourselves.
      process.removeAllListeners("SIGTERM")
      process.removeAllListeners("SIGINT")
      try { process.kill(process.pid, signal); return } catch { /* unknown signal name */ }
      process.exit(1)
    }
    process.exit(code ?? 0)
  })
}

module.exports = { passthrough, fatal }
