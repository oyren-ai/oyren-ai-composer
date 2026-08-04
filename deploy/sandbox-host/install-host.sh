#!/usr/bin/env bash
# Provision a sandbox droplet with everything the agent runtime needs, ON THE VM.
#
# This is the VM equivalent of what oyren-sandbox's base Docker image used to provide. Agents now
# run directly on the droplet rather than inside a container, so the packages, the `oyren` user and
# the PATH/env that used to be image layers have to exist on the host instead.
#
# Docker CE is still installed (by the bake's install-remote.sh) but only for the AGENT's own use —
# building and testing the user's project. Nothing hosts the session in a container any more.
#
# Idempotent: safe to re-run on a re-bake. Runs as root during the snapshot bake.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

PNPM_VERSION="${PNPM_VERSION:-10.33.0}"
SANDBOX_USER="${SANDBOX_USER:-oyren}"
PNPM_HOME="${PNPM_HOME:-/usr/local/share/pnpm}"
APT="apt-get -o DPkg::Lock::Timeout=300"

echo "==> Base packages"
$APT update -qq
$APT install -y -qq --no-install-recommends git tmux ca-certificates curl sudo ripgrep

echo "==> GitHub CLI (its own apt repo)"
if ! command -v gh >/dev/null 2>&1; then
  mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  $APT update -qq
  $APT install -y -qq --no-install-recommends gh
fi

# node is installed by bake-install.sh before this runs; corepack ships with it.
echo "==> pnpm ${PNPM_VERSION} (corepack)"
mkdir -p "$PNPM_HOME"
corepack enable
corepack prepare "pnpm@${PNPM_VERSION}" --activate

# The container set these as ENV layers. On a VM they have to reach BOTH interactive shells (the
# user's terminal, the agent's tmux session) and the systemd units, hence two files.
echo "==> Shell + service environment"
cat > /etc/profile.d/10-oyren-path.sh <<EOF
export PATH="${PNPM_HOME}:/app/node_modules/.bin:\$PATH"
export PNPM_HOME="${PNPM_HOME}"
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
EOF
chmod 0644 /etc/profile.d/10-oyren-path.sh

mkdir -p /etc/oyren
cat > /etc/oyren/host.env <<EOF
PATH=${PNPM_HOME}:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
PNPM_HOME=${PNPM_HOME}
LANG=C.UTF-8
LC_ALL=C.UTF-8
# npm/pnpm on a small droplet hit flaky registry TLS; the container tuned these the same way.
npm_config_fetch_retries=6
npm_config_fetch_retry_mintimeout=10000
npm_config_fetch_retry_maxtimeout=600000
npm_config_fetch_timeout=600000
EOF
chmod 0644 /etc/oyren/host.env

echo "==> ${SANDBOX_USER} user"
if ! getent passwd "$SANDBOX_USER" >/dev/null; then
  useradd --create-home --shell /bin/bash "$SANDBOX_USER"
fi
# The agent installs packages and runs builds as itself; the VM is the isolation boundary, so
# passwordless sudo is intentional here (same trade the container made).
echo "$SANDBOX_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$SANDBOX_USER"
chmod 0440 "/etc/sudoers.d/$SANDBOX_USER"
mkdir -p /workspace
chown -R "$SANDBOX_USER:$SANDBOX_USER" /workspace "$PNPM_HOME"

echo "==> git system config"
git config --system user.name "Oyren Sandbox"
git config --system user.email "sandbox@oyren.ai"
git config --system credential.helper oyren
git config --system credential.https://github.com.useHttpPath true
git config --system --add safe.directory '*'

echo "✅ sandbox host provisioned (user=${SANDBOX_USER}, pnpm=${PNPM_VERSION})"