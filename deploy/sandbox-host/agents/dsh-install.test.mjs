import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const HERE = dirname(fileURLToPath(import.meta.url))
const INSTALLER = join(HERE, "dsh.sh")
const VERSION_FILE = join(HERE, "../../versions.env")
const VERSION = /^DSH_VERSION=(.+)$/m.exec(readFileSync(VERSION_FILE, "utf8"))?.[1]

test("the Composer pin is the published 0.1.5 release candidate", () => {
  assert.equal(VERSION, "0.1.5-rc.1")
})

test("the versioned DSH install is rerun-safe and flips only after its checks", () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-install-"))
  const fakeBin = join(root, "fake-bin")
  const link = join(root, "oyren-dsh")
  const dshBin = join(root, "bin", "dsh")
  const calls = join(root, "pnpm.calls")
  mkdirSync(fakeBin)
  mkdirSync(dirname(dshBin))
  mkdirSync(`${link}-0.1.0-rc.7`)

  const pnpm = join(fakeBin, "pnpm")
  writeFileSync(pnpm, `#!/bin/sh
printf '%s\\n' "$*" >> "$DSH_TEST_CALLS"
mkdir -p node_modules/.bin node_modules/.pnpm
printf '%s\\n' '#!/bin/sh' 'echo "${VERSION}"' > node_modules/.bin/dsh
chmod 0755 node_modules/.bin/dsh
`)
  chmodSync(pnpm, 0o755)

  const driver = `
set -euo pipefail
source "${INSTALLER}"
patch_dsh_trusted_host() { test -d "$1/node_modules/.pnpm"; }
dsh_settings_trust_smoke() { test -L "${link}"; }
install_dsh "${VERSION}" "${link}"
install_dsh "${VERSION}" "${link}"
`
  const result = spawnSync("bash", ["-c", driver], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, DSH_BIN: dshBin, DSH_TEST_CALLS: calls },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readlinkSync(link), `${link}-${VERSION}`)
  assert.equal(existsSync(`${link}-0.1.0-rc.7`), false)
  assert.match(readFileSync(dshBin, "utf8"), new RegExp(`${link}/node_modules/\\.bin/dsh`))

  const installs = readFileSync(calls, "utf8").trim().split("\n")
  assert.equal(installs.length, 2)
  for (const call of installs) {
    assert.match(call, new RegExp(`@deepseek-ai/dsh@${VERSION.replaceAll(".", "\\.")}`))
    for (const allowed of ["@deepseek-ai/dsh-subprocess-local", "koffi", "node-pty", "@google/genai", "protobufjs"]) {
      assert.match(call, new RegExp(`--allow-build=${allowed.replaceAll("/", "\\/")}`))
    }
  }
})
