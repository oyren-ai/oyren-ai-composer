const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { findGitRepoDir, findGitRepoDirs, workdirFrom } = require("./workspaceRepo")

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-wsrepo-"))

test("a workdir that is itself a repo root resolves to exactly itself", () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, ".git"))
  assert.deepEqual(findGitRepoDirs(dir), [dir])
  assert.equal(findGitRepoDir(dir), dir)
})

test("a top-level multi-repo layout returns EVERY repo child, sorted; findGitRepoDir = the first", () => {
  const workdir = tmp()
  fs.mkdirSync(path.join(workdir, "zeta", ".git"), { recursive: true })
  fs.mkdirSync(path.join(workdir, "alpha", ".git"), { recursive: true })
  fs.mkdirSync(path.join(workdir, "not-a-repo"))
  assert.deepEqual(findGitRepoDirs(workdir), [path.join(workdir, "alpha"), path.join(workdir, "zeta")])
  assert.equal(findGitRepoDir(workdir), path.join(workdir, "alpha"))
})

test("a repo-less or missing workdir resolves to [] / null", () => {
  assert.deepEqual(findGitRepoDirs(tmp()), [])
  assert.deepEqual(findGitRepoDirs(path.join(os.tmpdir(), "oyren-wsrepo-does-not-exist")), [])
  assert.equal(findGitRepoDir(tmp()), null)
})

test("workdirFrom prefers WORKING_DIR, then WORKDIR, then /workspace", () => {
  assert.equal(workdirFrom({ WORKING_DIR: "/a", WORKDIR: "/b" }), "/a")
  assert.equal(workdirFrom({ WORKDIR: "/b" }), "/b")
  assert.equal(workdirFrom({}), "/workspace")
})
