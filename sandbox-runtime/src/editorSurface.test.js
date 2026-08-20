const { test } = require("node:test")
const assert = require("node:assert")
const { switchSurface, surfaceStatus, SURFACE_FILE, UNITS } = require("./editorSurface")

/** Records every command and answers from a scripted table: `{ "systemctl is-active x": {...} }`. */
function fakeExec(answers = {}) {
  const calls = []
  const exec = async (cmd, args) => {
    const line = [cmd, ...args].join(" ")
    calls.push(line)
    for (const [match, result] of Object.entries(answers)) {
      if (line.includes(match)) return { code: 0, stdout: "", stderr: "", ...result }
    }
    return { code: 0, stdout: "", stderr: "" }
  }
  return { exec, calls }
}

test("switch to zed: records the surface, stops the editor, starts zed — in that order", async () => {
  const { exec, calls } = fakeExec()
  const result = await switchSurface("zed", { exec })
  assert.equal(result.ok, true)
  const wrote = calls.findIndex((c) => c.includes(SURFACE_FILE))
  const stopped = calls.indexOf(`sudo -n systemctl stop ${UNITS.vscode}`)
  const started = calls.indexOf(`sudo -n systemctl start ${UNITS.zed}`)
  assert.ok(wrote >= 0 && stopped >= 0 && started >= 0, calls.join("\n"))
  assert.ok(wrote < stopped && stopped < started, `expected write → stop → start, got:\n${calls.join("\n")}`)
})

test("the surface file is written BEFORE the start — the launcher's gate reads it", async () => {
  // Without this ordering `systemctl start oyren-zed` exits 0 on a session launched as vscode.
  const { exec, calls } = fakeExec()
  await switchSurface("zed", { exec })
  assert.match(calls[0], new RegExp(`printf .* zed > ${SURFACE_FILE}`))
})

test("switch to vscode stops zed", async () => {
  const { exec, calls } = fakeExec()
  await switchSurface("vscode", { exec })
  assert.ok(calls.includes(`sudo -n systemctl stop ${UNITS.zed}`), calls.join("\n"))
  assert.ok(calls.includes(`sudo -n systemctl start ${UNITS.vscode}`), calls.join("\n"))
})

test("an unknown surface is rejected before anything runs", async () => {
  for (const bad of ["", "none", "emacs", undefined, null]) {
    const { exec, calls } = fakeExec()
    const result = await switchSurface(bad, { exec })
    assert.equal(result.ok, false, String(bad))
    assert.equal(result.status, 400)
    assert.deepEqual(calls, [], `must not touch the box for ${String(bad)}`)
  }
})

test("a failed write aborts before stopping anything — never leave the user with no editor", async () => {
  const { exec, calls } = fakeExec({ [SURFACE_FILE]: { code: 1, stderr: "read-only file system" } })
  const result = await switchSurface("zed", { exec })
  assert.equal(result.ok, false)
  assert.equal(result.status, 500)
  assert.match(result.error, /read-only/)
  assert.ok(!calls.some((c) => c.includes("systemctl")), calls.join("\n"))
})

test("a failed start is reported (the user is looking at a blank pane)", async () => {
  const { exec } = fakeExec({ [`systemctl start ${UNITS.zed}`]: { code: 5, stderr: "unit not found" } })
  const result = await switchSurface("zed", { exec })
  assert.equal(result.ok, false)
  assert.match(result.error, /unit not found/)
})

test("a failed stop is NOT fatal — the wanted surface still comes up", async () => {
  const { exec } = fakeExec({ [`systemctl stop ${UNITS.vscode}`]: { code: 1, stderr: "job timed out" } })
  const result = await switchSurface("zed", { exec })
  assert.equal(result.ok, true)
})

test("switching to the surface already running is idempotent, not an error", async () => {
  const { exec } = fakeExec({ "is-active oyren-zed": { stdout: "active\n" } })
  const result = await switchSurface("zed", { exec })
  assert.equal(result.ok, true)
  assert.equal(result.units.zed, "active")
})

test("status reports both units and the recorded surface", async () => {
  const { exec } = fakeExec({
    [`is-active ${UNITS.zed}`]: { stdout: "active\n" },
    [`is-active ${UNITS.vscode}`]: { stdout: "inactive\n" },
    [`cat ${SURFACE_FILE}`]: { stdout: "ZED\n" },
  })
  assert.deepEqual(await surfaceStatus({ exec }), { surface: "zed", units: { zed: "active", vscode: "inactive" } })
})

test("status reports surface null when nothing has been switched yet", async () => {
  const { exec } = fakeExec({ [`cat ${SURFACE_FILE}`]: { code: 1, stdout: "" } })
  assert.equal((await surfaceStatus({ exec })).surface, null)
})
