#!/usr/bin/env bash
# Publish the editor's fast-changing layer — the Oyren extensions + settings — as the rolling
# "editor-extras" release on the public fork. Every session installs it at editor start
# (oyren-editor-update --boot) and a live session refreshes with `oyren-editor-update`, so shipping
# an extension or settings tweak is THIS script (~seconds), not a snapshot bake (~15 minutes).
#
# The bake still copies the same files into the image as the offline fallback — publish AND commit,
# or a fresh snapshot quietly resurrects old extras for offline sessions.
#
# Usage: ./pack-editor-extras.sh          (from deploy/editor; needs gh auth with repo access)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="oyren-ai/openvscode-server"
TAG="editor-extras"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

mkdir -p "$OUT/pack/extensions" "$OUT/pack/settings"
cp -R "$HERE/oyren-agent-extension" "$OUT/pack/extensions/"
cp -R "$HERE/oyren-welcome-extension" "$OUT/pack/extensions/"
cp "$HERE/machine-settings.json" "$OUT/pack/settings/machine-settings.json"
# Mirror seed-editor-settings.sh's User seed (first boot only on the consuming side).
cat > "$OUT/pack/settings/user-settings.json" <<'EOF'
{
  "workbench.startupEditor": "none",
  "workbench.welcomePage.walkthroughs.openOnInstall": false
}
EOF
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$OUT/pack/BUILT_AT"

# Sanity before anything leaves this machine: broken JSON here bricks every new session's editor
# layer until the next publish.
node -e 'for (const f of process.argv.slice(1)) JSON.parse(require("fs").readFileSync(f))' \
  "$OUT"/pack/extensions/*/package.json "$OUT"/pack/settings/*.json
for js in "$OUT"/pack/extensions/*/*.js; do node --check "$js"; done

tar -czf "$OUT/oyren-editor-extras.tar.gz" -C "$OUT/pack" extensions settings BUILT_AT
ls -lh "$OUT/oyren-editor-extras.tar.gz"

# Rolling release: same tag forever, asset clobbered. Prerelease so it never shadows real builds.
gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 \
  || gh release create "$TAG" --repo "$REPO" --prerelease --title "editor extras (rolling)" \
       --notes "Rolling channel for the Oyren editor's extensions + settings. Sessions fetch this at editor start; the snapshot carries an offline fallback. Not a server build."
gh release upload "$TAG" --repo "$REPO" --clobber "$OUT/oyren-editor-extras.tar.gz"
echo "✅ published — new sessions pick it up at boot; live ones via oyren-editor-update"
