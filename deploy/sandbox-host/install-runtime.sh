#!/usr/bin/env bash
# Install the sandbox runtime — the node server that fronts a session (reverse proxy, token-gated
# tmux terminal, agent stream, /_oyren/control API, resource stats) — onto the droplet at /app.
#
# This used to be COPY'd into the oyren-sandbox image. Agents run on the VM now, so it is installed
# on the host and supervised by systemd instead of by a container entrypoint.
#
# Idempotent: safe to re-run on a re-bake. Runs as root during the snapshot bake.
set -euo pipefail

APP_DIR="${APP_DIR:-/app}"
SANDBOX_USER="${SANDBOX_USER:-oyren}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_SRC="$(cd "$HERE/../../sandbox-runtime" && pwd)"

export PNPM_HOME="${PNPM_HOME:-/usr/local/share/pnpm}"
export PATH="$PNPM_HOME:$PATH"
# Same 1GB-bake V8 ceiling problem as the agent installs — see install-agents.sh.
export NODE_OPTIONS="--max-old-space-size=3072${NODE_OPTIONS:+ $NODE_OPTIONS}"

echo "==> Runtime source -> ${APP_DIR}"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
# cp, not rsync: rsync is only guaranteed on the bake droplet because the bake pushes files to it,
# and a session droplet re-running this must not depend on that.
cp -a "$RUNTIME_SRC"/. "$APP_DIR"/
rm -rf "$APP_DIR/node_modules"

echo "==> Production dependencies (node-pty builds natively)"
cd "$APP_DIR"
pnpm install --prod --frozen-lockfile
# node-pty is the web terminal. pnpm 10 only runs its build script because package.json lists it
# under `pnpm.onlyBuiltDependencies` — and pnpm 11 NO LONGER READS THAT FIELD ("The \"pnpm\" field in
# package.json is no longer read by pnpm ... onlyBuiltDependencies"), it moved to pnpm-workspace.yaml.
# So the day PNPM_VERSION is bumped past 10, this install silently skips the gyp build and the
# snapshot ships with a terminal that dies on `require("node-pty")`. Load it and fail the bake here
# instead — a broken terminal is not something to discover from a user.
node -e 'require("node-pty")' \
  || { echo "ERROR: node-pty did not build — the web terminal would be dead in this image." >&2
       echo "       pnpm $(pnpm --version) may be ignoring package.json's pnpm.onlyBuiltDependencies;" >&2
       echo "       see install-host.sh PNPM_VERSION and pnpm's settings migration." >&2
       exit 1; }

echo "==> Helper commands on PATH"
install -m 0755 "$APP_DIR/bin/oyren" /usr/local/bin/oyren
# $BROWSER for every shell (deploy/browser/install-browser.sh writes the profile.d line that
# points at it): opens a URL in the sandbox's own browser, which is the only browser whose
# localhost is this machine — see bin/oyren-open.
install -m 0755 "$APP_DIR/bin/oyren-open" /usr/local/bin/oyren-open
install -m 0755 "$APP_DIR/welcome.sh" /usr/local/bin/oyren-welcome
install -m 0755 "$APP_DIR/git-credential-oyren.sh" /usr/local/bin/git-credential-oyren
# Backs the editor's terminal-profile dropdown: one profile per agent, plus "Agent", which attaches
# to the very tmux session Oyren's own web terminal shows.
install -m 0755 "$APP_DIR/agent-term.sh" /usr/local/bin/oyren-agent-term
# The DeepSeek Harness launcher. Its own command rather than a case inside agent-launch.sh because
# dsh is a web app, not a TUI: any session can serve it on demand (`oyren-dsh-web`), whether or not
# it was launched with AGENT_KIND=deepseek-harness.
install -m 0755 "$APP_DIR/dsh-web.sh" /usr/local/bin/oyren-dsh-web
# The native Chat panel's claude replacement once claudeCode.claudeProcessWrapper points at it
# (openvscode-server's oyren/settings/machine-settings.json) — installed under its OWN name so it
# never shadows the pnpm-global `claude` shim it wraps. v2: a contract-faithful relay — flag off
# (OYREN_CLAUDE_WRAPPER != 1) it execs the extension's exact argv; flag on it hands the spawn to
# the broker in server.js, which OWNS the child, so a closed panel's SIGKILL only drops a socket:
# the in-flight turn completes and claude flushes its transcript for --resume. That is Level B
# survival (turn-completion + resume-from-disk), NOT live panel reattach. Multi-file now, so it
# lands as a lib dir plus a 2-line bin shim. See sandbox-runtime/claude-wrapper/main.js.
install -d -m 0755 /usr/local/lib/oyren-claude-wrapper
install -m 0644 "$APP_DIR"/claude-wrapper/*.js /usr/local/lib/oyren-claude-wrapper/
printf '%s\n' '#!/usr/bin/env node' 'require("/usr/local/lib/oyren-claude-wrapper/main.js")' \
  > /usr/local/bin/oyren-claude-wrapper
chmod 0755 /usr/local/bin/oyren-claude-wrapper
# Refresh the editor's extensions+settings from the rolling release — the no-rebake update path.
# The swap helper is its escalation: when the extras manifest names a different server build, the
# updater calls it to replace the whole /opt/openvscode-server tree.
install -m 0755 "$APP_DIR/oyren-editor-update.sh" /usr/local/bin/oyren-editor-update
install -m 0755 "$APP_DIR/oyren-editor-server-swap.sh" /usr/local/bin/oyren-editor-server-swap
# Deliberately shadows the apt-installed gh at /usr/bin/gh — /usr/local/bin comes first on PATH,
# and the wrapper is what injects the session's short-lived GitHub token.
install -m 0755 "$APP_DIR/gh-wrapper.sh" /usr/local/bin/gh
ln -sf /usr/local/bin/oyren-welcome /usr/local/bin/oyren-help
install -m 0644 "$APP_DIR/tmux.conf" /etc/tmux.conf
chmod +x "$APP_DIR/entrypoint.sh" "$APP_DIR/agent-launch.sh" "$APP_DIR/agent-term.sh" "$APP_DIR/dsh-web.sh"

echo "==> Session launchers + systemd units"
# All three launchers share sessionEnv.mjs + editorSurface.mjs via RELATIVE imports (start-zed.mjs
# lands here too, from install-zed.sh), so they must land in one directory —
# and they keep their .mjs extension, which is what tells node to load them as ES modules (an
# extensionless /usr/local/bin/oyren-start-sandbox would be parsed as CommonJS and fail on `import`).
install -d -m 0755 /usr/local/lib/oyren
install -m 0644 "$HERE/sessionEnv.mjs" /usr/local/lib/oyren/sessionEnv.mjs
install -m 0644 "$HERE/editorSurface.mjs" /usr/local/lib/oyren/editorSurface.mjs
install -m 0755 "$HERE/start-sandbox.mjs" /usr/local/lib/oyren/start-sandbox.mjs
install -m 0755 "$HERE/start-editor.mjs" /usr/local/lib/oyren/start-editor.mjs
install -m 0644 "$HERE/../units/oyren-sandbox.service" /etc/systemd/system/oyren-sandbox.service
install -m 0644 "$HERE/../units/oyren-editor.service" /etc/systemd/system/oyren-editor.service

# The welcome banner on interactive shells (guarded so a re-bake doesn't append it twice).
if ! grep -q OYREN_WELCOMED /etc/bash.bashrc 2>/dev/null; then
  printf '%s\n' 'if [ -n "$PS1" ] && [ -z "${OYREN_WELCOMED:-}" ]; then export OYREN_WELCOMED=1; oyren-welcome; fi' \
    >> /etc/bash.bashrc
fi

chown -R "$SANDBOX_USER:$SANDBOX_USER" "$APP_DIR"

systemctl daemon-reload
# Enabled but inert: ConditionPathExists=/etc/oyren/sandbox.env means it no-ops during the bake and
# only starts once cloud-init writes that file on a real session droplet.
systemctl enable oyren-sandbox.service

# The runtime's identity in the image manifest is a hash of the trees that make it up (the server
# plus the launchers and units in deploy/sandbox-host), computed exactly the way the bake runner
# hashes a release, so `oyren update --check` can tell a changed runtime from an unchanged one.
source "$HERE/../lib/tree-hash.sh"
"$HERE/../manifest/stamp.sh" runtime "$(cd "$HERE/../.." && tree_hash sandbox-runtime deploy/sandbox-host)"

echo "✅ sandbox runtime installed at ${APP_DIR}"