// Tests for the launcher-side surface gate. This is what decides whether `systemctl start
// oyren-zed` on a session launched as VS Code actually brings Zed up (it must) and whether the
// small-tier OYREN_EDITOR=0 kill switch still means "no editor" (it must).
import { test } from "node:test"
import assert from "node:assert/strict"
import { NONE, VSCODE, ZED, parseSurfaceFile, resolveSurface } from "./editorSurface.mjs"

test("launch env decides when nothing has been switched", () => {
  assert.equal(resolveSurface({ OYREN_ZED: "1", OYREN_EDITOR: "0" }), ZED) // a zed-web launch
  assert.equal(resolveSurface({}), VSCODE) // the default surface
  assert.equal(resolveSurface({ OYREN_EDITOR: "0" }), NONE) // small-tier kill switch, no Zed asked for
})

test("the surface file outranks the launch env — both ways", () => {
  assert.equal(resolveSurface({ OYREN_ZED: "1", OYREN_EDITOR: "0" }, "vscode"), VSCODE)
  assert.equal(resolveSurface({}, "zed"), ZED)
  // The case that makes switching work at all: a vscode launch sets OYREN_EDITOR unset/1 and no
  // OYREN_ZED, so without the file the zed launcher would exit 0 and the pane would stay blank.
  assert.equal(resolveSurface({ OYREN_EDITOR: "1" }, "zed"), ZED)
})

test("a switch to vscode overrides the OYREN_EDITOR=0 that a zed launch ships with", () => {
  assert.equal(resolveSurface({ OYREN_ZED: "1", OYREN_EDITOR: "0" }, "vscode"), VSCODE)
})

test("file contents are tolerated: whitespace, case, trailing newline", () => {
  for (const raw of ["zed", "ZED", " zed \n", "Zed\n"]) assert.equal(parseSurfaceFile(raw), ZED, raw)
  for (const raw of ["vscode", "VSCode\n"]) assert.equal(parseSurfaceFile(raw), VSCODE, raw)
})

test("garbage or absent file falls back to the launch env rather than breaking the session", () => {
  for (const raw of ["", "   ", "emacs", "none", null, undefined, "zed vscode"]) {
    assert.equal(parseSurfaceFile(raw), null, JSON.stringify(raw))
    assert.equal(resolveSurface({ OYREN_ZED: "1" }, raw), ZED, JSON.stringify(raw))
  }
})

test('"none" is not switchable — it would leave nothing to switch back with', () => {
  assert.equal(parseSurfaceFile("none"), null)
})
