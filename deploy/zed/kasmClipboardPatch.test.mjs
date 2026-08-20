// Tests for the KasmVNC "No clipboard changes" patch (kasmClipboardPatch.mjs).
//
// The important ones are BEHAVIOURAL: they distil the two upstream clipboard paths down to their
// minified control flow, run them before and after the patch, and assert the exact symptom the
// patch exists for — the SAME image, offered twice, only reaches the session once until the guard
// is gone. The string-level tests just keep the bake honest (idempotent, loud on a no-match).
import { test } from "node:test"
import assert from "node:assert/strict"
import { MARKER, patchClipboardDedupe, patchWwwTree } from "./kasmClipboardPatch.mjs"

/**
 * A faithful reduction of KasmVNC's client: `clipboardPasteFrom` (text) and
 * `clipboardPasteDataFrom` (binary/image) keep their upstream shape — including the image path's
 * `if(!i)if(i=hash(f),i===this._clipHash){...return}else this._clipHash=i` comma expression — so
 * the patch is exercised against the control flow it actually rewrites. `sent` stands in for the
 * WebSocket: one entry per clipboard delivered to the container.
 */
const UPSTREAM_CLIENT = `(() => {
  const j = () => {};
  const In = (b) => Array.from(b).join(",");
  return class {
    constructor(){ this._clipHash = 0; this.sent = [] }
    _send(bytes){ this.sent.push(String(bytes)) }
    clipboardPasteFrom(e){ let t=Array.from(e),r=In(t);if(r===this._clipHash){j("No clipboard changes");return}else this._clipHash=r; this._send(t) }
    clipboardPasteDataFrom(f){ let i=0;if(!i)if(i=In(f),i===this._clipHash){j("No clipboard changes");return}else this._clipHash=i; this._send(f) }
  }
})()`

const clientFrom = (source) => new Function(`return ${source}`)()

const IMAGE = [137, 80, 78, 71] // the same "screenshot" bytes every time
const TEXT = [104, 105]

test("upstream: the same image is delivered only once — the bug", () => {
  const client = new (clientFrom(UPSTREAM_CLIENT))()
  client.clipboardPasteDataFrom(IMAGE)
  client.clipboardPasteDataFrom(IMAGE)
  assert.equal(client.sent.length, 1)
})

test("patched: the same image is re-delivered on every focus", () => {
  const { source, replacements } = patchClipboardDedupe(UPSTREAM_CLIENT)
  assert.equal(replacements, 2) // one guard per clipboard path
  const client = new (clientFrom(source))()
  client.clipboardPasteDataFrom(IMAGE)
  client.clipboardPasteDataFrom(IMAGE)
  client.clipboardPasteDataFrom(IMAGE)
  assert.equal(client.sent.length, 3)
})

test("patched: a text clipboard is re-sent too (it is the same guard)", () => {
  const client = new (clientFrom(patchClipboardDedupe(UPSTREAM_CLIENT).source))()
  client.clipboardPasteFrom(TEXT)
  client.clipboardPasteFrom(TEXT)
  assert.equal(client.sent.length, 2)
})

test("patched: text overwriting the clipboard does not strand the image", () => {
  // The real-world sequence from the bug report: paste the image, paste some text (which takes over
  // the X selection), then reach for the same image again.
  const client = new (clientFrom(patchClipboardDedupe(UPSTREAM_CLIENT).source))()
  client.clipboardPasteDataFrom(IMAGE)
  client.clipboardPasteFrom(TEXT)
  client.clipboardPasteDataFrom(IMAGE)
  assert.deepEqual(client.sent, [String(IMAGE), String(TEXT), String(IMAGE)])
})

test("patched: _clipHash is still maintained (only the early return dies)", () => {
  const client = new (clientFrom(patchClipboardDedupe(UPSTREAM_CLIENT).source))()
  client.clipboardPasteDataFrom(IMAGE)
  assert.equal(client._clipHash, Array.from(IMAGE).join(","))
})

test("stamps a marker and is idempotent", () => {
  const once = patchClipboardDedupe(UPSTREAM_CLIENT)
  assert.ok(once.source.includes(MARKER))
  const twice = patchClipboardDedupe(once.source)
  assert.deepEqual(
    { replacements: twice.replacements, alreadyPatched: twice.alreadyPatched, source: twice.source },
    { replacements: 0, alreadyPatched: true, source: once.source },
  )
})

test("reports no replacements when the guard is absent (the bake must fail loudly)", () => {
  const result = patchClipboardDedupe("export const x = 1 // nothing clipboard-ish here")
  assert.deepEqual(result, {
    source: "export const x = 1 // nothing clipboard-ish here",
    replacements: 0,
    alreadyPatched: false,
  })
})

test("matches whatever the minifier named the hash variable", () => {
  const shapes = ["if(q===this._clipHash){return}", "if($x2===this._clipHash){return}", "if(_h===this._clipHash){return}"]
  for (const shape of shapes) {
    assert.equal(patchClipboardDedupe(shape).replacements, 1, shape)
  }
})

test("patchWwwTree writes only the files that carry the guard", () => {
  const files = {
    "/www/assets/ui-abc.js": UPSTREAM_CLIENT,
    "/www/screen.bundle.js": "export const unrelated = 1",
  }
  const written = {}
  const result = patchWwwTree("/www", {
    list: () => Object.keys(files),
    read: (p) => files[p],
    write: (p, s) => {
      written[p] = s
    },
  })
  assert.deepEqual(result.files, ["/www/assets/ui-abc.js"])
  assert.equal(result.replacements, 2)
  assert.equal(result.alreadyPatched, 0)
  assert.deepEqual(Object.keys(written), ["/www/assets/ui-abc.js"])
})

test("patchWwwTree counts an already-patched tree instead of rewriting it", () => {
  const patched = patchClipboardDedupe(UPSTREAM_CLIENT).source
  const result = patchWwwTree("/www", {
    list: () => ["/www/assets/ui-abc.js"],
    read: () => patched,
    write: () => assert.fail("must not rewrite an already-patched file"),
  })
  assert.deepEqual(result, { files: [], replacements: 0, alreadyPatched: 1 })
})
