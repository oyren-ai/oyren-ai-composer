#!/usr/bin/env bash
# SOURCE this file. The environment the container used to set as ENV layers. On a VM it has to
# reach BOTH interactive shells (the user's terminal, the agent's tmux session) and the systemd
# units, hence two files: a profile.d script and /etc/oyren/host.env (EnvironmentFile= for the
# units). install-workspace-dir.sh appends OYREN_WORKSPACE_DIR to host.env afterwards.

# write_host_env <pnpm-home>
write_host_env() {
  local pnpm_home="$1"
  cat > /etc/profile.d/10-oyren-path.sh <<EOF
export PATH="${pnpm_home}:/app/node_modules/.bin:\$PATH"
export PNPM_HOME="${pnpm_home}"
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
EOF
  chmod 0644 /etc/profile.d/10-oyren-path.sh

  mkdir -p /etc/oyren
  cat > /etc/oyren/host.env <<EOF
PATH=${pnpm_home}:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
PNPM_HOME=${pnpm_home}
LANG=C.UTF-8
LC_ALL=C.UTF-8
# npm/pnpm on a small droplet hit flaky registry TLS; the container tuned these the same way.
npm_config_fetch_retries=6
npm_config_fetch_retry_mintimeout=10000
npm_config_fetch_retry_maxtimeout=600000
npm_config_fetch_timeout=600000
# Kill switch for the native Chat panel's claude wrapper+broker, v2: turn-completion survival — a
# closed panel's kill only drops the wrapper's relay socket, and the broker-owned claude child
# finishes its in-flight turn and flushes the transcript for --resume (no live reattach). The flag
# alone changes nothing: the wrapper lands unconditionally (install-runtime.sh) but stays inert
# until the editor's claudeCode.claudeProcessWrapper machine setting points at it, and that setting
# ships separately, gated on a live end-to-end pass.
OYREN_CLAUDE_WRAPPER=1
EOF
  chmod 0644 /etc/oyren/host.env
}
