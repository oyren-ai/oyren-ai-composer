// An in-process broker (real registry + real unix socket server) on a throwaway socket path, so the
// suites drive the REAL wrapper binary against the REAL broker code — the only fake is the claude
// CLI itself (test/fixtures/fake-claude.js).
const os = require("os")
const path = require("path")
const fs = require("fs")
const { createRegistry } = require("../../src/claudeWrapperRegistry")
const { startSocketServer } = require("../../src/claudeWrapperSocket")
const { waitFor } = require("./fakeExtension")

function startTestBroker({ cap, drainMs, log } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-wrapper-test-"))
  const socketPath = path.join(dir, "broker.sock")
  const logs = []
  const registry = createRegistry({ cap, drainMs, log: log || ((m) => logs.push(m)) })
  const server = startSocketServer(socketPath, registry)
  return {
    dir,
    socketPath,
    registry,
    server,
    logs,
    ready: () => waitFor(() => fs.existsSync(socketPath), 3000, "broker socket to exist"),
    dumpPath: (name) => path.join(dir, `${name}.json`),
    readDump: (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")),
    close: () => { registry.killAll(); server.close() },
  }
}

module.exports = { startTestBroker }
