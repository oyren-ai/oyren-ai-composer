#!/usr/bin/env bash
# Bring the editor's FAST-CHANGING layer — Oyren extensions + settings — up to date from the rolling
# "editor-extras" release, without a snapshot rebake and without relaunching the session.
#
# The bake still ships a working copy of everything; this only overlays newer bits. Any failure
# (offline, bad tarball, 404) leaves the baked copies untouched — download and extraction happen in
# a temp dir and only a verified result is copied into place.
#
#   oyren-editor-update          fetch + install + restart the editor (run it inside a session)
#   oyren-editor-update --boot   fetch + install only (systemd ExecStartPre; failure must be inert)
#
# Env:
#   OYREN_EDITOR_EXTRAS_URL  override the tarball URL; set to "0" to disable fetching entirely.
set -uo pipefail

DEFAULT_URL="https://github.com/oyren-ai/openvscode-server/releases/download/editor-extras/oyren-editor-extras.tar.gz"
URL="${OYREN_EDITOR_EXTRAS_URL:-$DEFAULT_URL}"
INSTALL_DIR="${INSTALL_DIR:-/opt/openvscode-server}"
DATA="$HOME/.openvscode-server/data"

[ "$URL" = "0" ] && { echo "editor extras disabled (OYREN_EDITOR_EXTRAS_URL=0)"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! curl -fsSL --max-time 15 --retry 2 -o "$TMP/extras.tar.gz" "$URL"; then
  echo "editor extras unreachable — keeping the baked copies"; exit 0
fi
if ! tar -xzf "$TMP/extras.tar.gz" -C "$TMP" || [ ! -d "$TMP/extensions" ]; then
  echo "editor extras tarball malformed — keeping the baked copies"; exit 0
fi

# Extensions: whole-directory swap per extension (a partial copy would be worse than stale).
for ext in "$TMP"/extensions/*/; do
  name="$(basename "$ext")"
  rm -rf "$INSTALL_DIR/extensions/$name.new"
  cp -R "$ext" "$INSTALL_DIR/extensions/$name.new" && rm -rf "$INSTALL_DIR/extensions/$name" \
    && mv "$INSTALL_DIR/extensions/$name.new" "$INSTALL_DIR/extensions/$name"
done

# Settings: Machine always follows extras; the User seed only lands on first boot (it is the user's
# file after that — clobbering their edits on every update would be hostile).
if [ -f "$TMP/settings/machine-settings.json" ]; then
  mkdir -p "$DATA/Machine" && cp "$TMP/settings/machine-settings.json" "$DATA/Machine/settings.json"
fi
if [ -f "$TMP/settings/user-settings.json" ] && [ ! -f "$DATA/User/.oyren-seeded" ]; then
  mkdir -p "$DATA/User" && cp "$TMP/settings/user-settings.json" "$DATA/User/settings.json" && touch "$DATA/User/.oyren-seeded"
fi

echo "editor extras installed ($(cat "$TMP/BUILT_AT" 2>/dev/null || echo "unversioned"))"
if [ "${1:-}" != "--boot" ]; then
  sudo systemctl restart oyren-editor && echo "editor restarted — reload the browser tab"
fi
