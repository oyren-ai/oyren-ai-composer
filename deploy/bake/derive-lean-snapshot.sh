#!/usr/bin/env bash
# Derive the LEAN snapshot from an existing BASE snapshot.
#
# LEGACY PATH — kept until the lean-foundation bake (bake-lean-foundation.sh + `VARIANT=lean`
# bake-base-snapshot.sh, docs/plans/lean-foundation-bake.md) has produced a lean image that a real
# Lean Codespace has run on. The workflow no longer calls this script.
#
# Two snapshots exist because Mathlib costs 3-5GB and only the Lean app needs it. Rather than bake
# everything twice, this boots one droplet from the finished base snapshot, adds Lean + Mathlib, and
# snapshots it again. The two images then differ by exactly deploy/lean/install-lean.sh.
#
# Usage:
#   DO_API_TOKEN=... DO_SSH_KEY_ID=... BASE_SNAPSHOT_ID=... ./derive-lean-snapshot.sh
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh

: "${BASE_SNAPSHOT_ID:?must be set — the image id printed by the base bake}"

NAME="oyren-derive-lean-$(date +%s)"
# Mirrors bake-base-snapshot.sh: variant in the name, UTC HHMM so same-day runs don't collide.
SNAPSHOT_NAME="${SNAPSHOT_NAME:-oyren-sandbox-lean-$(date -u +%Y-%m-%d-%H%M)}"

# DISK SIZE IS THE CONSTRAINT, NOT CPU. DigitalOcean refuses to boot an image onto a droplet whose
# disk is smaller than the one the image was made on, so the size used HERE sets the minimum size of
# every future Lean session droplet. Lean is not size-gated (it runs on any tier, default s), so the
# 25GB floor must be preserved — which rules out s-2vcpu-4gb (80GB) and every other roomy size.
#
# In fra1 the ONLY sizes with a 25GB disk are the 1GB s-1vcpu-1gb family. c-2 (4GB RAM / 25GB) looks
# ideal in the global size list but DigitalOcean rejects it here with
# "Size is not available in this region" — availability is per-region, and the global list does not
# say so. Check `/v2/sizes` filtered on `.regions | index("<region>")` before changing this.
#
# 1GB is workable because `lake exe cache get` DOWNLOADS prebuilt oleans rather than compiling
# Mathlib from source, so the step is I/O-bound, and the snapshot carries a 4GB swapfile. The base
# image uses 11.5GB of the 25GB disk, leaving ample room for Mathlib's 3-5GB.
SIZE="${DERIVE_SIZE:-s-1vcpu-1gb}"

echo "▶ booting $NAME from base snapshot $BASE_SNAPSHOT_ID ($SIZE)"
DROPLET_ID="$(create_droplet "$NAME" "$SIZE" "$BASE_SNAPSHOT_ID" "$DO_SSH_KEY_ID" "$DO_REGION")"
trap 'echo "▶ deleting derive droplet $DROPLET_ID"; delete_droplet "$DROPLET_ID"' EXIT

wait_droplet_active "$DROPLET_ID"
IP="$(droplet_public_ip "$DROPLET_ID")"
wait_ssh "$IP"
echo "▶ droplet $DROPLET_ID active at $IP"

# The base snapshot already carries deploy/, but push the current checkout so a derive picks up
# local edits to the Lean assets without re-baking the base first.
echo "▶ syncing lean assets"
ssh -o StrictHostKeyChecking=accept-new "root@$IP" 'mkdir -p /srv/composer/app/deploy/lean'
rsync -az --delete ../lean/ "root@$IP:/srv/composer/app/deploy/lean/"

echo "▶ installing Lean + Mathlib (several minutes)"
ssh -o StrictHostKeyChecking=accept-new "root@$IP" 'bash /srv/composer/app/deploy/lean/install-lean.sh'

# Same reason as the base bake: without this, droplets from the snapshot think cloud-init already
# ran and skip their own user_data — the part that writes /etc/oyren/sandbox.env and starts the
# session. Must be last.
echo "▶ resetting cloud-init"
ssh -o StrictHostKeyChecking=accept-new "root@$IP" 'cloud-init clean --logs'

echo "▶ snapshotting as $SNAPSHOT_NAME"
IMAGE_ID="$(snapshot_droplet "$DROPLET_ID" "$SNAPSHOT_NAME")"

echo "✅ lean snapshot ready: $SNAPSHOT_NAME (image id: $IMAGE_ID)"
echo "   Set DROPLET_SNAPSHOT_ID_LEAN=$IMAGE_ID in the orchestrator."
