// Streaming-input plumbing for the persistent Agent SDK session (agentEngine). The SDK's `query()`
// consumes `prompt` as an AsyncIterable<SDKUserMessage>; we back it with a never-ending async generator
// that BLOCKS until a message is pushed. That is what lets the HTTP layer inject a new user message at
// ANY time — including while the agent is mid-turn — which is the whole point of the interactive redesign
// (the old `claude -p` took its prompt as an arg and accepted no further input until it exited).
function createInputStream() {
  const queue = []
  let wake = null // resolver of the promise the generator awaits while the queue is empty
  let closed = false

  async function* stream() {
    while (true) {
      if (queue.length) { yield queue.shift(); continue }
      if (closed) return
      await new Promise((resolve) => { wake = resolve })
    }
  }
  const bump = () => { if (wake) { const w = wake; wake = null; w() } }
  function push(message) { queue.push(message); bump() }
  function close() { closed = true; bump() }

  return { stream: stream(), push, close }
}

// Wrap a turn's payload into the SDKUserMessage shape the generator yields. `payload` is either the raw
// Anthropic content array the frontend already emits (image blocks before text) or a bare prompt string
// (loops / curl). `parent_tool_use_id: null` marks it as a top-level user turn, not a tool reply.
function buildUserMessage(payload) {
  const content = Array.isArray(payload) ? payload : [{ type: "text", text: String(payload) }]
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null }
}

module.exports = { createInputStream, buildUserMessage }
