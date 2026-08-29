#!/usr/bin/env bash
# SOURCE this file. Chromium for claude's playwright MCP: shared, world-readable, outside any home
# dir so every agent reuses one copy instead of downloading ~150MB on first use. The in-VM browser
# (deploy/browser) reuses this same Chrome.

# install_playwright_mcp <version> — the MCP package plus its Chromium and system deps.
install_playwright_mcp() {
  local version="$1" npm_root mcp_dir core
  export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"
  echo "==> playwright MCP ${version} + chromium"
  HOME=/root npm install -g "@playwright/mcp@${version}"
  # The Dockerfile hardcoded /usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright-
  # core/cli.js. TWO assumptions in that path break on a VM, and each killed a bake: the prefix
  # (NodeSource installs globals under /usr, not /usr/local) and the nesting (npm hoists
  # playwright-core to the global root). So resolve both dynamically: ask npm for its global root,
  # then ask node where the mcp package would load playwright-core from, with a search as last resort.
  npm_root="$(npm root -g)"
  mcp_dir="$npm_root/@playwright/mcp"
  core="$(node -e "console.log(require.resolve('playwright-core/cli.js',{paths:['$mcp_dir']}))" 2>/dev/null || true)"
  [ -n "$core" ] || core="$(find "$npm_root" -path '*playwright-core/cli.js' -print -quit 2>/dev/null || true)"
  [ -n "$core" ] || { echo "ERROR: playwright-core cli.js not found after install" >&2; return 1; }
  echo "    playwright-core cli: $core"
  apt-get -o DPkg::Lock::Timeout=300 update -qq
  HOME=/root node "$core" install-deps chromium
  HOME=/root node "$core" install --no-shell chromium
  chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"
}
