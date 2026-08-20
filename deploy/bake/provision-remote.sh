#!/usr/bin/env bash
# Runs ON the bake droplet as root — streamed over SSH by bake-snapshot.sh via `bash -s`, so this
# file itself never lands on the droplet's disk. Everything installed here gets baked into the
# sandbox snapshot; anything per-session (/etc/oyren/sandbox.env, `systemctl start oyren-sandbox`)
# arrives via cloud-init user_data at real-droplet boot and must NOT appear here.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Swap FIRST, and it bakes into the snapshot: (1) the s-1vcpu-1gb bake droplet OOM-freezes
# mid docker-ce install without it; (2) every session droplet inherits it, so in-container
# workloads (builds, tests) spill to swap instead of getting OOM-killed — the whole reason
# sessions moved off App Platform.
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# First boot races us for the dpkg lock (cloud-init's own apt activity, then unattended-upgrades) —
# wait it out, then give apt a lock timeout for any stragglers.
#
# `cloud-init status --wait` alone is NOT enough: it returns while unattended-upgrades can still
# hold the lock, and the lock that kills `apt-get update` is the LISTS lock, which
# `-o DPkg::Lock::Timeout` does not wait on at all (that option covers the dpkg FRONTEND lock).
# deploy/wait-for-apt.sh flocks all three and is what bake-install.sh and the zed stack install
# already call — but this script is streamed over SSH by bake-base-snapshot.sh, so it can only
# reach the copy in the checkout that same script rsyncs up moments earlier. Fall back to the bare
# cloud-init wait if a caller ever runs this without pre-placing the checkout.
wait_for_apt() {
  if [ -f /srv/composer/app/deploy/wait-for-apt.sh ]; then
    bash /srv/composer/app/deploy/wait-for-apt.sh
  else
    cloud-init status --wait >/dev/null 2>&1 || true
  fi
}
wait_for_apt
APT="apt-get -o DPkg::Lock::Timeout=300"

# git first (needed for the composer clone below); then Docker CE via the official convenience
# script — sandbox droplets run each session's image as a container, so the daemon is baked in.
$APT update -qq
$APT install -y -qq git
# get.docker.com drives its own apt, so it needs its own wait: unattended-upgrades can wake up in
# the gap between our install finishing and the script's first apt call.
wait_for_apt
curl -fsSL https://get.docker.com | sh

# The "composer" supervisor. A pre-placed checkout (rsynced up by bake-snapshot.sh when
# COMPOSER_LOCAL_DIR is set) wins; otherwise plain https clone — the repo must be PUBLIC (or
# reachable through a deploy key provisioned by other means). We deliberately skip
# COMPOSER_GIT_TOKEN support — a token used in the clone URL persists in
# /srv/composer/app/.git/config inside the snapshot forever, readable by anything that later
# runs on any sandbox droplet.
if [ ! -d /srv/composer/app ]; then
  git clone https://github.com/oyren-ai/oyren-ai-composer.git /srv/composer/app
fi

# deploy/bake-install.sh owns the rest of the contract (lives in the composer repo, written in
# parallel with this): install Node 24, npm ci, build, install + enable the oyren-* systemd
# units. Their ConditionPathExists=/etc/oyren/sandbox.env makes the bake-time enable a no-op.
bash /srv/composer/app/deploy/bake-install.sh

# No docker pulls here: sandbox images vary per launch, so pre-warming any single one is waste.
echo "✅ sandbox bake provisioning complete"
