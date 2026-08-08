const { test } = require("node:test")
const assert = require("node:assert")
const net = require("net")
const os = require("os")
const path = require("path")
const fs = require("fs")

// Must be set before requiring the module under test — DEFAULT_SOCKET_PATH resolves the env var at
// require time (module load), same as production (one process, one boot-time env read).
const TEST_SOCKET_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "broker-boot-")), "broker.sock")
process.env.OYREN_CLAUDE_WRAPPER_SOCKET = TEST_SOCKET_PATH

const { maybeStartClaudeWrapperBroker } = require("./startClaudeWrapperBroker")

test("the flag off (unset) never starts the broker", () => {
  delete process.env.OYREN_CLAUDE_WRAPPER
  const result = maybeStartClaudeWrapperBroker()
  assert.equal(result, null)
  assert.equal(fs.existsSync(TEST_SOCKET_PATH), false)
})

test('the flag off ("0", anything other than "1") never starts the broker', () => {
  process.env.OYREN_CLAUDE_WRAPPER = "0"
  const result = maybeStartClaudeWrapperBroker()
  assert.equal(result, null)
})

test('OYREN_CLAUDE_WRAPPER="1" starts a real, connectable broker on DEFAULT_SOCKET_PATH', async () => {
  process.env.OYREN_CLAUDE_WRAPPER = "1"
  const started = maybeStartClaudeWrapperBroker()
  try {
    assert.ok(started, "must return the registry + server, not null, when the flag is on")
    await new Promise((resolve, reject) => {
      const socket = net.createConnection(TEST_SOCKET_PATH)
      socket.on("connect", () => { socket.end(); resolve() })
      socket.on("error", reject)
    })
  } finally {
    started.registry.killAll()
    started.server.close()
    delete process.env.OYREN_CLAUDE_WRAPPER
  }
})
