#!/usr/bin/env bash
# Runs ON the lean-foundation droplet as root — streamed over SSH by bake-lean-foundation.sh via
# `bash -s`, so this file never lands on the droplet's disk. Only what deploy/lean/install-lean.sh
# needs goes in here; everything else (Node, Docker, the agent CLIs, the editor, the runtime) is the
# base provisioning's job and is laid on top of this image by bake-base-snapshot.sh later. Anything
# done here MUST be a no-op when that provisioning re-runs it, which is why the user is created with
# install-host.sh's exact useradd line.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

SANDBOX_USER="${SANDBOX_USER:-oyren}"

# Swap FIRST (same block as provision-remote.sh, which skips it when the file already exists):
# `lake exe cache get` + `lake build` on a 1GB droplet OOM without it.
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# First boot races us for the apt locks — see deploy/wait-for-apt.sh (rsynced up moments ago).
bash /srv/composer/app/deploy/wait-for-apt.sh
APT="apt-get -o DPkg::Lock::Timeout=300"
$APT update -qq
# git: lake fetches Mathlib over git. curl + ca-certificates: elan-init and the cache download.
$APT install -y -qq --no-install-recommends git curl ca-certificates

# The user, exactly as install-host.sh creates it, so the later base provisioning finds it and
# changes nothing — ownership of ~oyren/.elan and the Lean project must survive that pass.
echo "==> ${SANDBOX_USER} user"
if ! getent passwd "$SANDBOX_USER" >/dev/null; then
  useradd --create-home --shell /bin/bash "$SANDBOX_USER"
fi

# The workspace dir must already belong to the user: install-lean.sh mkdir -p's its Lean project
# under it, which would otherwise leave ~oyren/workspace itself root-owned until install-host.sh's
# install-workspace-dir.sh fixes it during the base provisioning.
install -d -o "$SANDBOX_USER" -g "$SANDBOX_USER" "$(getent passwd "$SANDBOX_USER" | cut -d: -f6)/workspace"

# The editor is not here yet, so install-lean.sh skips the infoview extension; the base
# provisioning re-runs it once the editor exists and that pass installs the extension.
SANDBOX_USER="$SANDBOX_USER" bash /srv/composer/app/deploy/lean/install-lean.sh

echo "✅ lean foundation provisioning complete"
