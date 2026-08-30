#!/usr/bin/env bash
# SOURCE this file. The commands and units the runtime tree at /app contributes to the host, split
# from runtime-lib.sh so each file stays small. Idempotent: `install` overwrites in place.

# install_runtime_helpers <app> — the runtime's helper commands on PATH, plus tmux.conf.
install_runtime_helpers() {
  local app="$1"
  # `oyren` is a shim into the ACTIVE runtime (through the /app symlink), not a copy of bin/oyren:
  # its commands live in src/cli/, and a runtime update must not leave a stale CLI on PATH.
  printf '%s\n' '#!/usr/bin/env node' 'require("/app/src/cli/main.js")' > /usr/local/bin/oyren
  chmod 0755 /usr/local/bin/oyren
  # $BROWSER for every shell (deploy/browser/install-browser.sh writes the profile.d line that
  # points at it): opens a URL in the sandbox's own browser, the only browser whose localhost is
  # this machine — see bin/oyren-open.
  install -m 0755 "$app/bin/oyren-open" /usr/local/bin/oyren-open
  install -m 0755 "$app/welcome.sh" /usr/local/bin/oyren-welcome
  install -m 0755 "$app/git-credential-oyren.sh" /usr/local/bin/git-credential-oyren
  # Backs the editor's terminal-profile dropdown: one profile per agent, plus "Agent", which
  # attaches to the very tmux session Oyren's own web terminal shows.
  install -m 0755 "$app/agent-term.sh" /usr/local/bin/oyren-agent-term
  # The DeepSeek Harness launcher: dsh is a web app, not a TUI, so any session can serve it on
  # demand whether or not it was launched with AGENT_KIND=deepseek-harness.
  install -m 0755 "$app/dsh-web.sh" /usr/local/bin/oyren-dsh-web
  # The native Chat panel's claude replacement once claudeCode.claudeProcessWrapper points at it,
  # installed under its OWN name so it never shadows the pnpm-global `claude` shim it wraps. See
  # sandbox-runtime/claude-wrapper/main.js for what it does with the child.
  install -d -m 0755 /usr/local/lib/oyren-claude-wrapper
  install -m 0644 "$app"/claude-wrapper/*.js /usr/local/lib/oyren-claude-wrapper/
  printf '%s\n' '#!/usr/bin/env node' 'require("/usr/local/lib/oyren-claude-wrapper/main.js")' \
    > /usr/local/bin/oyren-claude-wrapper
  chmod 0755 /usr/local/bin/oyren-claude-wrapper
  # The editor's no-rebake update path and its escalation (whole-server swap).
  install -m 0755 "$app/oyren-editor-update.sh" /usr/local/bin/oyren-editor-update
  install -m 0755 "$app/oyren-editor-server-swap.sh" /usr/local/bin/oyren-editor-server-swap
  # Deliberately shadows the apt-installed gh at /usr/bin/gh — /usr/local/bin comes first on PATH,
  # and the wrapper is what injects the session's short-lived GitHub token.
  install -m 0755 "$app/gh-wrapper.sh" /usr/local/bin/gh
  ln -sf /usr/local/bin/oyren-welcome /usr/local/bin/oyren-help
  # The in-place updater and the pre-snapshot quiesce, as shims into the installed composer tree
  # (which an update swaps, so the shim always runs the current version's script).
  printf '%s\n' '#!/bin/sh' 'exec bash /srv/composer/app/deploy/update/oyren-update.sh "$@"' > /usr/local/bin/oyren-update
  printf '%s\n' '#!/bin/sh' 'exec bash /srv/composer/app/deploy/update/oyren-quiesce.sh "$@"' > /usr/local/bin/oyren-quiesce
  chmod 0755 /usr/local/bin/oyren-update /usr/local/bin/oyren-quiesce
  install -m 0644 "$app/tmux.conf" /etc/tmux.conf
  # tmux-resurrect, vendored in the runtime tree (sandbox-runtime/tmux-plugins/VENDOR.md) and so
  # pinned by the runtime hash. Copied, not linked: /app moves on every update, and the tmux server
  # outlives any one runtime tree. The .new+mv shuffle keeps a mid-update reader off a half tree.
  install -d -m 0755 /usr/local/lib/oyren
  rm -rf /usr/local/lib/oyren/tmux-plugins.new
  cp -a "$app/tmux-plugins" /usr/local/lib/oyren/tmux-plugins.new
  chmod -R a+rX /usr/local/lib/oyren/tmux-plugins.new
  rm -rf /usr/local/lib/oyren/tmux-plugins
  mv /usr/local/lib/oyren/tmux-plugins.new /usr/local/lib/oyren/tmux-plugins
  chmod +x "$app/entrypoint.sh" "$app/agent-launch.sh" "$app/agent-term.sh" "$app/dsh-web.sh"
}

# install_runtime_units <deploy/sandbox-host dir> — the session launchers and the two units.
# The launchers share sessionEnv.mjs + editorSurface.mjs via RELATIVE imports (start-zed.mjs lands
# in the same dir from install-zed.sh), so they must live together, and they keep their .mjs
# extension so node loads them as ES modules.
install_runtime_units() {
  local here="$1"
  install -d -m 0755 /usr/local/lib/oyren
  install -m 0644 "$here/sessionEnv.mjs" /usr/local/lib/oyren/sessionEnv.mjs
  install -m 0644 "$here/editorSurface.mjs" /usr/local/lib/oyren/editorSurface.mjs
  install -m 0755 "$here/start-sandbox.mjs" /usr/local/lib/oyren/start-sandbox.mjs
  install -m 0755 "$here/start-editor.mjs" /usr/local/lib/oyren/start-editor.mjs
  install -m 0755 "$here/start-tmux.mjs" /usr/local/lib/oyren/start-tmux.mjs
  install -m 0755 "$here/run-tmux-server.sh" /usr/local/lib/oyren/run-tmux-server.sh
  install -m 0644 "$here/../units/oyren-sandbox.service" /etc/systemd/system/oyren-sandbox.service
  install -m 0644 "$here/../units/oyren-editor.service" /etc/systemd/system/oyren-editor.service
  # The tmux server's unit, pulled in by the drop-in so a runtime restart never kills the shells.
  install -m 0644 "$here/../units/oyren-tmux.service" /etc/systemd/system/oyren-tmux.service
  install -D -m 0644 "$here/../units/oyren-sandbox.service.d/20-tmux.conf" /etc/systemd/system/oyren-sandbox.service.d/20-tmux.conf
  # The welcome banner on interactive shells (guarded so a re-run doesn't append it twice).
  if ! grep -q OYREN_WELCOMED /etc/bash.bashrc 2>/dev/null; then
    printf '%s\n' 'if [ -n "$PS1" ] && [ -z "${OYREN_WELCOMED:-}" ]; then export OYREN_WELCOMED=1; oyren-welcome; fi' \
      >> /etc/bash.bashrc
  fi
}
