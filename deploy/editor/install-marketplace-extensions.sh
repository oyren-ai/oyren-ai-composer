#!/usr/bin/env bash
# Install marketplace CLI-agent extensions (Claude Code, Codex, Qwen Code) into the baked editor.
# Called by install-editor.sh after the openvscode-server tarball is in place.
#
# All come from Open VSX — NEVER Microsoft's Marketplace (its terms forbid non-Microsoft products;
# same reason extensionsGallery is left alone). Each declares extensionKind:["workspace"] and ships
# linux-x64, i.e. runs in the SERVER-side extension host beside its CLI binary and the session's
# credentials. Non-fatal on purpose: a registry hiccup must not sink a 15-minute bake.
#
# Env:
#   EDITOR_USER               unix user that owns and runs the editor (default: oyren)
#   INSTALL_DIR               where the server lives (default: /opt/openvscode-server)
#   INSTALL_CLAUDE_EXTENSION  1 (default) installs anthropic.claude-code
#   INSTALL_CODEX_EXTENSION   1 (default) installs openai.chatgpt (Codex)
#   INSTALL_QWEN_EXTENSION    1 (default) installs qwenlm.qwen-code-vscode-ide-companion
set -euo pipefail

EDITOR_USER="${EDITOR_USER:-oyren}"
INSTALL_DIR="${INSTALL_DIR:-/opt/openvscode-server}"

install_ext() { su - "$EDITOR_USER" -c "'$INSTALL_DIR/bin/openvscode-server' --install-extension '$1'"; }

# Move the Qwen extension's view container from the Activity Bar to the Secondary Side Bar. This
# single key rename makes it render as a QWEN tab next to CLAUDE CODE/CODEX (the views map key
# resolves identically in either location; onView activation is already present). User extensions
# live outside INSTALL_DIR, so the editor-extras boot overlay never reverts this; a manual
# in-session extension update would, until the next bake. Non-fatal top to bottom — on any failure
# we WARN and the tab merely stays in the activity bar.
patch_qwen_manifest() {
  local home manifest
  home="$(getent passwd "$EDITOR_USER" | cut -d: -f6)" \
    || { echo "    WARNING: no home for $EDITOR_USER — QWEN tab stays in the activity bar" >&2; return 0; }
  for manifest in "$home"/.openvscode-server/extensions/qwenlm.qwen-code-vscode-ide-companion-*/package.json; do
    [ -f "$manifest" ] || continue
    # JSON transform via node, never sed: exits 0 as a no-op when there is nothing to move or the
    # move already happened (idempotent re-bakes).
    if node -e '
      const fs = require("fs"), p = process.argv[1];
      const m = JSON.parse(fs.readFileSync(p, "utf8"));
      const vc = m.contributes && m.contributes.viewsContainers;
      if (!vc || !vc.activitybar || vc.secondarySidebar) process.exit(0);
      vc.secondarySidebar = vc.activitybar;
      delete vc.activitybar;
      fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
    ' "$manifest"; then
      echo "    manifest -> Secondary Side Bar: $(basename "$(dirname "$manifest")")"
    else
      echo "    WARNING: manifest patch failed — QWEN tab stays in the activity bar" >&2
    fi
  done
  return 0
}

if [ "${INSTALL_CLAUDE_EXTENSION:-1}" = "1" ]; then
  echo "==> Claude Code extension (Open VSX)"
  # Open VSX publishes the namespace as "Anthropic"; VS Code ids are conventionally lowercased.
  # Try the canonical id first, then the namespace-cased form, before giving up.
  if install_ext anthropic.claude-code || install_ext Anthropic.claude-code; then
    echo "    installed"
  else
    echo "    WARNING: claude-code extension unavailable — editor and chat pane are unaffected" >&2
  fi
fi

if [ "${INSTALL_CODEX_EXTENSION:-1}" = "1" ]; then
  echo "==> Codex extension (Open VSX)"
  if install_ext openai.chatgpt; then
    echo "    installed"
  else
    echo "    WARNING: codex extension unavailable — editor and chat pane are unaffected" >&2
  fi
fi

if [ "${INSTALL_QWEN_EXTENSION:-1}" = "1" ]; then
  echo "==> Qwen Code extension (Open VSX)"
  # Pin the qwenlm namespace EXACTLY — a typosquat johannaglover73.* exists on Open VSX. The
  # platform-specific VSIX resolves linux-x64 on the droplet.
  if install_ext qwenlm.qwen-code-vscode-ide-companion; then
    echo "    installed"
    patch_qwen_manifest
  else
    echo "    WARNING: qwen extension unavailable — editor and chat pane are unaffected" >&2
  fi
fi
