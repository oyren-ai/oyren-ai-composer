// pageShell.js is the one document shell behind the gateway and logs pages. What these pin is the
// reason it exists: the pages are embedded in the Oyren app's header popover (~560×384, light-themed
// for most users), so the shell must follow the viewer's theme and must not lay itself out like a
// full-height landing page.
const { test } = require("node:test")
const assert = require("node:assert")
const { renderPage, escapeHtml } = require("./pageShell")

test("renderPage wraps the body in a full document and escapes the title", () => {
  const html = renderPage({ title: "Oyren <Test>", body: '<p id="x">hi</p>' })
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<title>Oyren &lt;Test&gt;<\/title>/)
  assert.match(html, /<p id="x">hi<\/p>/)
  assert.match(html, /<meta name="viewport"/)
})

test("the shell follows the viewer's theme instead of hard-coding dark", () => {
  const html = renderPage({ title: "t", body: "" })
  assert.match(html, /color-scheme:\s*light dark/)
  assert.match(html, /@media \(prefers-color-scheme: dark\)/)
  assert.doesNotMatch(html, /color-scheme:\s*dark\s*;/)
  assert.match(html, /background:\s*var\(--bg\)/) // colors come from tokens, not literals, on body
})

test("the shell is compact enough for the header popover", () => {
  const html = renderPage({ title: "t", body: "" })
  assert.doesNotMatch(html, /min-height:\s*100vh/)
  assert.doesNotMatch(html, /padding:\s*40px/)
})

test("a page's own CSS lands inside <style> and its script inside <script>", () => {
  const html = renderPage({ title: "t", body: "", extraCss: "#log { color: red; }", script: "var a = 1;" })
  assert.match(html, /#log \{ color: red; \}[\s\S]*<\/style>/)
  assert.match(html, /<script>\s*var a = 1;\s*<\/script>/)
})

test("no <script> tag is emitted when the page has no script", () => {
  assert.doesNotMatch(renderPage({ title: "t", body: "" }), /<script>/)
})

test("escapeHtml escapes all dangerous characters", () => {
  assert.equal(escapeHtml('<script>alert("xss")&\'</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&amp;&#39;&lt;/script&gt;')
})
