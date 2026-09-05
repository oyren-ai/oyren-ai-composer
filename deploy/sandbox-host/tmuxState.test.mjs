// tmux-state, exercised against a REAL tmux and the REAL vendored resurrect scripts under an
// isolated TMUX_TMPDIR: the exact save -> server death -> restore path the incident needed and did
// not have. The empty-server guard is load-bearing (resurrect itself would re-point `last` at a
// layout with nothing in it) and is asserted here, not assumed.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { sanitizeKey, sessionKey, socketPath, stateDir } from "./tmuxStateCore.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, "tmux-state.mjs")
const CONF = join(HERE, "../../sandbox-runtime/tmux.conf")
const PLUGINS = join(HERE, "../../sandbox-runtime/tmux-plugins")
const haveTmux = spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test("the session key falls back slug, uuid, default, and never leaves the filename alphabet", () => {
  assert.equal(sessionKey({ OYREN_SESSION_SLUG: "sb-1", OYREN_SESSION_UUID: "u" }), "sb-1")
  assert.equal(sessionKey({ OYREN_SESSION_UUID: "u-2" }), "u-2")
  assert.equal(sessionKey({}), "default")
  assert.equal(sanitizeKey("a/b c$d"), "a-b-c-d")
})

test("state dir and socket derive from the overridable env, never a hardcoded uid", () => {
  const env = { OYREN_TMUX_STATE_DIR: "/s", OYREN_SESSION_SLUG: "k", TMUX_TMPDIR: "/t" }
  assert.equal(stateDir(env), "/s/k")
  assert.equal(socketPath(env, 501), "/t/tmux-501/default")
})

test("save, die, restore: layout and cwds come back; empty servers are never recorded; the agent returns", { skip: !haveTmux }, async (t) => {
  // realpath, because tmux reports RESOLVED pane paths and macOS tempdirs live behind a symlink.
  const TMP = realpathSync(mkdtempSync(join(tmpdir(), "oyren-tmux-state-")))
  const wa = join(TMP, "wa"); const wb = join(TMP, "wb")
  mkdirSync(wa); mkdirSync(wb)
  const env = {
    PATH: process.env.PATH, HOME: TMP, TMUX_TMPDIR: TMP,
    OYREN_TMUX_STATE_DIR: join(TMP, "state"), OYREN_TMUX_PLUGINS: PLUGINS, OYREN_SESSION_SLUG: "sb-1",
  }
  const tmux = (...args) => spawnSync("tmux", ["-f", CONF, ...args], { encoding: "utf8", env })
  const cli = (cmd, extraEnv = {}, flag = []) =>
    spawnSync("node", [CLI, cmd, ...flag], { encoding: "utf8", env: { ...env, ...extraEnv } })
  let server = null
  const emptyServer = async () => {
    // A freshly killed server can still be holding its socket for a beat, so a new -D server may
    // fail with "server exited unexpectedly". Retry until one actually answers `list-sessions` —
    // socket existence is not enough, since a dead server's socket path lingers.
    for (let attempt = 0; attempt < 6; attempt++) {
      server = spawn("tmux", ["-f", CONF, "-u", "-D"], { stdio: "ignore", env })
      for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null || server.signalCode !== null) break
        if (spawnSync("tmux", ["-f", CONF, "list-sessions"], { encoding: "utf8", env }).status === 0) return
        await sleep(100)
      }
      try { server.kill() } catch {}
      await sleep(200)
    }
  }
  t.after(() => { tmux("kill-server"); try { server?.kill() } catch {} })

  // A session shaped like the incident: two windows, one split, distinct cwds.
  assert.equal(tmux("new-session", "-d", "-s", "main", "-c", wa, "sleep 300").status, 0)
  assert.equal(tmux("new-window", "-t", "main", "-n", "two", "-c", wb, "sleep 300").status, 0)
  assert.equal(tmux("split-window", "-t", "main:two", "-c", wa, "sleep 300").status, 0)

  const saved = cli("save")
  assert.match(saved.stdout, /saved 3 pane/, saved.stderr)
  const last = join(TMP, "state", "sb-1", "last")
  assert.ok(existsSync(last), "last symlink written")
  const goodSave = statSync(last).mtimeMs

  // The server dies with everything in it; an EMPTY replacement must not clobber the good save.
  tmux("kill-server")
  await emptyServer()
  const emptied = cli("save")
  assert.match(emptied.stdout, /empty server, not saving/)
  assert.equal(statSync(last).mtimeMs, goodSave, "the good save survived the empty server")

  const restored = cli("restore")
  assert.match(restored.stdout, /restored from/, restored.stderr)
  const windows = tmux("list-windows", "-a", "-F", "#{window_name}").stdout
  assert.match(windows, /two/)
  const panes = tmux("list-panes", "-a", "-F", "#{pane_current_path}").stdout.trim().split("\n")
  assert.equal(panes.length, 3, `three panes back, got: ${panes.join(", ")}`)
  assert.ok(panes.includes(wa) && panes.includes(wb), "cwds restored")
  assert.match(cli("restore").stdout, /already restored/, "restore is once per server lifetime")

  // remember, then the agent path: a fresh empty server restores AND puts the agent back in main:0.0.
  writeFileSync(join(TMP, "agent.sh"), `#!/bin/sh\necho started > ${join(TMP, "marker")}\nexec sleep 300\n`)
  chmodSync(join(TMP, "agent.sh"), 0o755)
  assert.match(cli("remember", { WORKING_DIR: wb, WORKDIR: wb }).stdout, /remembered 2 value/)
  assert.equal(statSync(join(TMP, "state", "sb-1", "session-env")).mode & 0o777, 0o600)
  tmux("kill-server"); try { server?.kill() } catch {}
  await emptyServer()
  const agentEnv = { AGENT_KIND: "claude-code", OYREN_AGENT_LAUNCH: join(TMP, "agent.sh") }
  const again = cli("restore", agentEnv)
  assert.match(again.stdout, /agent back in main:0\.0/, again.stderr)
  for (let i = 0; i < 20 && !existsSync(join(TMP, "marker")); i++) await sleep(100)
  assert.ok(existsSync(join(TMP, "marker")), "the agent launcher actually ran")
  assert.match(tmux("display", "-p", "-t", "main:0.0", "#{pane_current_path}").stdout.trim(), new RegExp(`${wb}$`), "agent respawned in the remembered WORKING_DIR")

  // A CLONE (new droplet, new slug, OYREN_RESTORED=1) adopts the disk's newest session.
  tmux("kill-server"); try { server?.kill() } catch {}
  await emptyServer()
  const adopted = cli("restore", { OYREN_SESSION_SLUG: "sb-9", OYREN_RESTORED: "1" })
  assert.match(adopted.stdout, /restored from/, adopted.stderr)
  assert.match(tmux("list-windows", "-a", "-F", "#{window_name}").stdout, /two/)

  // A different slug WITHOUT the restored flag stays fresh: no cross-session bleed.
  tmux("kill-server"); try { server?.kill() } catch {}
  await emptyServer()
  assert.match(cli("restore", { OYREN_SESSION_SLUG: "sb-5" }).stdout, /fresh session, nothing to restore/)

  // Root refusal: the socket derivation would silently look at the wrong uid.
  const asRoot = spawnSync("node", ["-e", `process.getuid = () => 0; await import(${JSON.stringify(CLI)})`, "--input-type=module"], { encoding: "utf8", env })
  assert.notEqual(asRoot.status, 0)
})
