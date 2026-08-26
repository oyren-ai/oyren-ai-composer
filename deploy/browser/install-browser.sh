#!/usr/bin/env bash
# The in-VM browser: launcher, unit, and the $BROWSER hook. Runs as root during the snapshot bake,
# AFTER install-agents.sh (its Chrome comes from that script's Playwright install) and AFTER
# install-zed.sh (it reuses KasmVNC, openbox and zedStack.mjs from the zed stack). Idempotent.
#
# No browser is DOWNLOADED here. The image already carries a real Chrome build under /ms-playwright
# for the playwright MCP, with its shared-library deps installed — reusing it costs zero image size
# and, unlike an apt chromium (a snap on noble), it is Chrome, which matters when the point is
# signing into Google.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"

command -v Xkasmvnc >/dev/null || command -v Xvnc >/dev/null \
  || { echo "ERROR: KasmVNC missing — run deploy/zed/install-zed-stack.sh first" >&2; exit 1; }
command -v openbox >/dev/null \
  || { echo "ERROR: openbox missing — run deploy/zed/install-zed-stack.sh first" >&2; exit 1; }

echo "==> locating the image's Chrome"
CHROME=""
for d in $(ls -1 "$PLAYWRIGHT_BROWSERS_PATH" 2>/dev/null | grep '^chromium-' | sort -t- -k2 -rn); do
  for p in "$PLAYWRIGHT_BROWSERS_PATH/$d/chrome-linux64/chrome" "$PLAYWRIGHT_BROWSERS_PATH/$d/chrome-linux/chrome"; do
    [ -x "$p" ] && { CHROME="$p"; break 2; }
  done
done
[ -n "$CHROME" ] || { echo "ERROR: no Chrome under $PLAYWRIGHT_BROWSERS_PATH — install-agents.sh runs first" >&2; exit 1; }
echo "    $CHROME"

# Chrome's own sandbox, kept ON. Ubuntu 24.04 forbids unprivileged user namespaces via AppArmor, so
# Chrome dies with "No usable sandbox!" unless the SUID helper exists — and the answer must not be
# --no-sandbox on the browser a user signs into Google with. Chrome looks for `chrome-sandbox`
# beside its own binary; Playwright ships the same helper as `chrome_sandbox` (underscore), unset.
# Verified on a live droplet: without this Chrome exits FATAL, with it the browser runs sandboxed.
echo "==> SUID chrome-sandbox helper"
SANDBOX_SRC="$(dirname "$CHROME")/chrome_sandbox"
[ -f "$SANDBOX_SRC" ] || { echo "ERROR: $SANDBOX_SRC missing — playwright's chromium layout changed" >&2; exit 1; }
install -m 4755 -o root -g root "$SANDBOX_SRC" "$(dirname "$CHROME")/chrome-sandbox"

echo "==> launcher + unit"
# Beside start-zed.mjs: it imports ./sessionEnv.mjs and ./zedStack.mjs by RELATIVE path, which is
# only correct if all three live in one directory.
install -d -m 0755 /usr/local/lib/oyren
install -m 0755 "$HERE/start-browser.mjs" /usr/local/lib/oyren/start-browser.mjs
install -m 0644 "$HERE/idleWatch.mjs" /usr/local/lib/oyren/idleWatch.mjs
install -m 0644 "$HERE/../units/oyren-browser.service" /etc/systemd/system/oyren-browser.service

# $BROWSER for every login shell AND every service that reads /etc/profile.d — this is what makes a
# CLI's "opening your browser…" land in the sandbox's browser instead of nowhere.
echo "==> \$BROWSER hook"
cat > /etc/profile.d/25-oyren-browser.sh <<'PROFILE'
# Point every CLI's browser-open at the sandbox's own browser (oyren-open). codex login, claude auth
# login, gh auth login and xdg-open all consult $BROWSER first, and their OAuth callbacks are
# LOOPBACK URLs — which only resolve correctly in a browser running on this machine.
export BROWSER=/usr/local/bin/oyren-open
PROFILE
chmod 0644 /etc/profile.d/25-oyren-browser.sh

systemctl daemon-reload
# NOT enabled: on-demand only (see the unit's header). oyren-open starts it.

# No pin to record: the browser is a launcher, a unit and a hook over Chrome from the playwright
# install, so its manifest identity is the hash of this directory.
source "$HERE/../lib/tree-hash.sh"
"$HERE/../manifest/stamp.sh" browser "$(cd "$HERE/../.." && tree_hash deploy/browser)"

echo "✅ in-VM browser installed (start it with \`oyren-open <url>\`)"
