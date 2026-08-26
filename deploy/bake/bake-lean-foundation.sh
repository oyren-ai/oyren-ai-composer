#!/usr/bin/env bash
# Bake the LEAN FOUNDATION snapshot: Ubuntu + the oyren user + elan + Mathlib, and nothing else.
#
# The Lean image used to be DERIVED from the finished base (derive-lean-snapshot.sh), so every base
# change re-ran Lean + Mathlib after the 17-minute base bake. DigitalOcean snapshots are whole disks,
# not layers, so the way to stop paying for Lean is to put it UNDERNEATH the base provisioning: this
# image changes only when deploy/lean/ does, and the lean image is then a normal base bake started
# from it — `BASE_IMAGE=<this id> VARIANT=lean ./bake-base-snapshot.sh`. See
# docs/plans/lean-foundation-bake.md.
#
# Re-bake cadence: when deploy/lean/ changes (toolchain, Mathlib pin, template, skills). Cost: one
# s-1vcpu-1gb droplet for ~10 minutes.
#
# Usage: DO_API_TOKEN=... DO_SSH_KEY_ID=... [DO_REGION=fra1] ./bake-lean-foundation.sh
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh

COMPOSER_DIR="$(cd ../.. && pwd)"
NAME="oyren-bake-leanfoundation-$(date +%s)"
# Its own family name, so pruneSnapshots.mjs never counts it against the lean images.
SNAPSHOT_NAME="${SNAPSHOT_NAME:-oyren-sandbox-leanfoundation-$(date -u +%Y-%m-%d-%H%M)}"

# Same size as the base bake, for the same reason: the disk this image is made on is the smallest
# disk any image built FROM it can boot on, and the lean image inherits that 25GB floor.
echo "▶ creating foundation droplet $NAME in $DO_REGION"
DROPLET_ID="$(create_droplet "$NAME" s-1vcpu-1gb ubuntu-24-04-x64 "$DO_SSH_KEY_ID" "$DO_REGION")"
trap 'echo "▶ deleting foundation droplet $DROPLET_ID"; delete_droplet "$DROPLET_ID"' EXIT

wait_droplet_active "$DROPLET_ID"
IP="$(droplet_public_ip "$DROPLET_ID")"
wait_ssh "$IP"
echo "▶ droplet $DROPLET_ID active at $IP"

# Only deploy/ is needed here (the Lean assets + wait-for-apt.sh). The lean bake later rsyncs the
# whole checkout over the top with --delete, so nothing placed now can go stale.
echo "▶ pre-placing deploy/"
retry 5 10 ssh -o StrictHostKeyChecking=accept-new "root@$IP" 'mkdir -p /srv/composer/app/deploy'
retry 5 10 rsync -az --delete "$COMPOSER_DIR/deploy/" "root@$IP:/srv/composer/app/deploy/"

echo "▶ provisioning (Lean + Mathlib: several minutes)"
retry 3 15 run_remote "$IP" ./foundation-remote.sh

# Same as the base bake: without this, droplets booted from the snapshot skip their own user_data.
echo "▶ resetting cloud-init"
retry 3 5 ssh -o StrictHostKeyChecking=accept-new "root@$IP" 'cloud-init clean --logs'

echo "▶ snapshotting as $SNAPSHOT_NAME (powers off first; takes a few minutes)"
IMAGE_ID="$(snapshot_droplet "$DROPLET_ID" "$SNAPSHOT_NAME")"

echo "✅ lean foundation ready: $SNAPSHOT_NAME (image id: $IMAGE_ID)"
echo "   Next: BASE_IMAGE=$IMAGE_ID VARIANT=lean ./bake-base-snapshot.sh  for the lean image."
