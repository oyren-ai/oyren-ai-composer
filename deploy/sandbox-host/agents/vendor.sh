#!/usr/bin/env bash
# SOURCE this file. The agents that come from a vendor installer rather than a pinned package:
# cursor and antigravity's `agy` have no version to pin, so they are not manifest components and a
# live update never touches them unless asked with --force (live-agents.sh). bun is pinned and is
# only what antigravity's acp shim needs at runtime.

install_cursor() {
  local user="${SANDBOX_USER:-oyren}"
  echo "==> cursor (vendor installer — no pinned version available)"
  su - "$user" -c 'curl https://cursor.com/install -fsS | bash'
  ln -sf "/home/$user/.local/bin/agent" /usr/local/bin/agent
  ln -sf "/home/$user/.local/bin/cursor-agent" /usr/local/bin/cursor-agent
}

install_agy() {
  local src
  echo "==> antigravity (vendor installer — no pinned version available)"
  curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin
  # The installer ignores --dir and drops the binary in $HOME/.local/bin — which is /root here, a
  # directory the sandbox user cannot read. In the container this was masked because the install
  # ran as `oyren`; on the VM it runs as root, so AGY_BIN would point at a path the agent can't run.
  if [ ! -x /usr/local/bin/agy ]; then
    src="$(command -v agy || true)"
    [ -n "$src" ] || src=/root/.local/bin/agy
    if [ -x "$src" ]; then
      install -m 0755 "$src" /usr/local/bin/agy
      echo "    relocated agy from $src"
    else
      echo "    WARNING: agy binary not found — antigravity launches will fail" >&2
    fi
  fi
}

# install_bun <bun-vX.Y.Z> — into /usr/local; unzip is only needed for the download.
install_bun() {
  local version="$1"
  echo "==> bun ${version}"
  apt-get -o DPkg::Lock::Timeout=300 install -y -qq --no-install-recommends unzip
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s -- "$version"
  apt-get -y -qq purge unzip && apt-get -y -qq autoremove
}
