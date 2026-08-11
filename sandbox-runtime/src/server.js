// Composition root: one Node process, one port. The HTTP router serves health/control/static/gateway
// and proxies to user apps via the Routes config or the single-port supervisor fallback; the upgrade
// handler routes the token-gated `/terminal` PTY to tmux and any other WebSocket to the user's app.
// Started by entrypoint.sh after the repo is cloned.
const http = require("http")
const cfg = require("./config")
const resolve = require("./resolve")
const { createRouter } = require("./router")
const { Supervisor } = require("./supervisor")
const { Routes } = require("./routes")
const { setupTerminal } = require("./terminal")
const { wsRouteFor } = require("./routeFor")
const { proxyWs } = require("./proxyWs")
const { IDE_PORT, ideAuth } = require("./ide")
const { seedClaudeAuth } = require("./seedClaudeAuth")
const { seedClaudeSettings } = require("./seedClaudeSettings")
const { seedCursorSettings } = require("./seedCursorSettings")
const { maybeStartClaudeWrapperBroker } = require("./startClaudeWrapperBroker")
const { installConsoleCapture } = require("./logBuffer")

// Tee this process's own console output (including the "[fatal] ..." breadcrumbs below) into the
// in-memory log buffer that /_oyren/logs serves — installed first, before anything else can log.
installConsoleCapture()

// Global crash breadcrumbs: the container has no persistent disk, so a silent restart wipes
// /workspace AND its logs — leaving no trace of WHY it died. Log loudly first. An unhandled
// rejection is usually a single bad connection, so log + keep serving everyone else; an uncaught
// exception leaves unknown state, so log + exit and let App Platform restart us cleanly. Either way
// the message survives in DO runtime logs, so the next restart's cause is visible (its ABSENCE then
// points at an OOM kill or a platform reschedule, which leave no JS error).
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", (reason && (reason.stack || reason.message)) || reason)
})
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", (err && (err.stack || err.message)) || err)
  process.exit(1)
})

// The WS upgrade handler runs outside any request try/catch — a throw here (bad proxy target, parse
// error) would become an uncaughtException and kill every session. Guard it so one bad upgrade only
// drops that socket.
function safeUpgrade(handler) {
  return (req, socket, head) => {
    try { handler(req, socket, head) } catch (e) {
      console.error("[upgrade] failed:", e && e.message)
      try { socket.destroy() } catch {}
    }
  }
}

// Subscription login: when a Claude Code setup-token was injected, seed onboarding/trust so the
// first interactive `claude` lands authenticated with no prompts. Best-effort — never block boot.
try { seedClaudeAuth() } catch (e) { console.error("seedClaudeAuth failed:", e && e.message) }

// Boot every `claude` session straight into bypassPermissions mode with no permission prompts, so
// the sandbox runs unattended. Best-effort — never block boot.
try { seedClaudeSettings() } catch (e) { console.error("seedClaudeSettings failed:", e && e.message) }

// Same for Cursor CLI: unrestricted approval + nested sandbox off so `agent acp` / interactive
// `agent` never hang on tool prompts. Best-effort — never block boot.
try { seedCursorSettings() } catch (e) { console.error("seedCursorSettings failed:", e && e.message) }

// Auto-checkpoint the agent's dirty/unpushed work onto a GitHub shadow ref every few minutes, so a
// container replacement never loses it (no-op unless an agent runtime with a repo; see gitCheckpoint.js).
try { require("./gitCheckpoint").start() } catch (e) { console.error("gitCheckpoint failed to start:", e && e.message) }

// Disconnect-survival broker for the native VS Code Chat panel's claude process — no-op unless
// OYREN_CLAUDE_WRAPPER=1 (see claude-process-wrapper.js + CONTINUITY_DESIGN_PLAN.md Feature 2).
try { maybeStartClaudeWrapperBroker() } catch (e) { console.error("claude wrapper broker failed to start:", e && e.message) }

// Keep this server (and its /_oyren/health route) responsive while agent builds peg the CPU — the DO
// probe recycles us after ~5 missed answers. Negative niceness needs privileges we may lack; best-effort.
try { require("os").setPriority(0, -5) } catch { /* unprivileged: keep the default priority */ }

const supervisor = new Supervisor({ workdir: cfg.WORKDIR, mode: cfg.OYREN_MODE, resolve })

// Routes: a config-file-driven reverse proxy layer. LLMs and the `oyren route` CLI write to
// /workspace/.oyren-routes.json; the server watches for changes and routes HTTP requests to
// the matching internal port. This coexists with the supervisor's single-port `expose` as a
// fallback for repos that haven't adopted routes yet.
const routes = new Routes(cfg.WORKDIR)
routes.watch()

const router = createRouter({ supervisor, workdir: cfg.WORKDIR, controlToken: cfg.CONTROL_TOKEN, routes })
const server = http.createServer(router)
const termWss = setupTerminal(cfg.WORKDIR)

server.on("upgrade", safeUpgrade((req, socket, head) => {
  const route = wsRouteFor(req.url)
  if (route.kind === "terminal") {
    const url = new URL(req.url, "http://localhost")
    if (!cfg.SESSION_TOKEN || url.searchParams.get("token") !== cfg.SESSION_TOKEN) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      return socket.destroy()
    }
    return termWss.handleUpgrade(req, socket, head, (ws) => termWss.emit("connection", ws, req))
  }
  if (route.kind === "ide") {
    // The token is in the PATH here, not the query: openvscode's client builds this URL from its
    // --server-base-path and only puts reconnectionToken in the query string.
    if (!ideAuth(req.url, cfg.SESSION_TOKEN)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      return socket.destroy()
    }
    // proxyWs replays the ORIGINAL url (unlike proxyHttp, which rewrites it to the stripped
    // downstream path) — which is exactly what the editor needs, since its base path must survive.
    return proxyWs(req, socket, head, IDE_PORT)
  }
  // WebSocket: try routes first, then supervisor.exposedPort
  if (routes) {
    const match = routes.match(req.url)
    if (match) return proxyWs(req, socket, head, match.route.port)
  }
  if (supervisor.exposedPort) return proxyWs(req, socket, head, supervisor.exposedPort)
  socket.destroy()
}))

server.listen(cfg.PORT, () => console.log(`oyren-sandbox listening on :${cfg.PORT}`))
