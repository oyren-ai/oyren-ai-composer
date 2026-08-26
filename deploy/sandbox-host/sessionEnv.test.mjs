import { test } from "node:test"
import assert from "node:assert/strict"
import { sessionEnv, withNodeHeap } from "./sessionEnv.mjs"

test("withNodeHeap adds the default heap ceiling and keeps an explicit one", () => {
  assert.equal(withNodeHeap({}).NODE_OPTIONS, "--max-old-space-size=4096")
  assert.equal(withNodeHeap({ OYREN_NODE_HEAP_MB: "2048" }).NODE_OPTIONS, "--max-old-space-size=2048")
  assert.equal(withNodeHeap({ NODE_OPTIONS: "--enable-source-maps" }).NODE_OPTIONS, "--max-old-space-size=4096 --enable-source-maps")
  assert.equal(withNodeHeap({ NODE_OPTIONS: "--max-old-space-size=512" }).NODE_OPTIONS, "--max-old-space-size=512")
  const input = { A: "1" }
  const out = withNodeHeap(input)
  assert.equal(input.NODE_OPTIONS, undefined, "input is not mutated")
  assert.equal(out.A, "1")
})

test("sessionEnv decodes the blob and stringifies values; unset means empty", () => {
  const saved = process.env.CONTAINER_ENV_B64
  try {
    delete process.env.CONTAINER_ENV_B64
    assert.deepEqual(sessionEnv(), {})
    process.env.CONTAINER_ENV_B64 = Buffer.from(JSON.stringify({ SESSION_TOKEN: "t", PORT: 8080 })).toString("base64")
    assert.deepEqual(sessionEnv(), { SESSION_TOKEN: "t", PORT: "8080" })
    process.env.CONTAINER_ENV_B64 = Buffer.from("[1]").toString("base64")
    assert.throws(() => sessionEnv(), /JSON object/)
  } finally {
    if (saved === undefined) delete process.env.CONTAINER_ENV_B64; else process.env.CONTAINER_ENV_B64 = saved
  }
})
