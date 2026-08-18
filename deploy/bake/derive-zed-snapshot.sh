#!/usr/bin/env bash
# Derive the ZED snapshot from an existing BASE snapshot.
#
# Streamed Zed (KasmVNC + openbox + lavapipe + a pinned Zed build, deploy/zed/) costs ~1.5GB that
# only zed-web sessions use, so it is NEVER baked into the base — the base's disk floor matters for
# every other launch. Instead: boot one droplet from the finished base snapshot, run
# deploy/zed/install-zed.sh, and snapshot it again. The two images then differ by exactly that dir.
#
# Usage:
#   DO_API_TOKEN=... DO_SSH_KEY_ID=... BASE_SNAPSHOT_ID=... ./derive-zed-snapshot.sh
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh

: "${BASE_SNAPSHOT_ID:?must be set — the image id printed by the base bake}"

NAME="oyren-derive-zed-$(date +%s)"
# Mirrors bake-base-snapshot.sh: variant in the name, UTC HHMM so same-day runs don't collide.
SNAPSHOT_NAME="${SNAPSHOT_NAME:-oyren-sandbox-zed-$(date -u +%Y-%m-%d-%H%M)}"

# DISK SIZE IS THE CONSTRAINT, NOT CPU. DigitalOcean refuses to boot an image onto a droplet whose
# disk is smaller than the one the image was made on, so the size used HERE sets the minimum size of
# every future zed session droplet. Zed sessions ARE xl/xxl-gated — but at RUNTIME, by the
# orchestrator (software rendering saturates small tiers); the gate belongs there, not to the image.
# Baking on a roomier size would permanently raise this image's droplet floor for no benefit, so the
# 25GB s-1vcpu-1gb family stays (in fra1 it is the ONLY 25GB-disk family — see derive-lean's note on
# per-region size availability before changing this).
#
# 1GB RAM is workable because nothing here compiles: apt + two tarball unpacks, all I/O-bound, with
# the base image's 4GB swapfile behind them. The ~1.5GB stack fits the base's ~13.5GB headroom.
SIZE="${DERIVE_SIZE:-s-1vcpu-1gb}"

echo "▶ booting $NAME from base snapshot $BASE_SNAPSHOT_ID ($SIZE)"
DROPLET_ID="$(create_droplet "$NAME" "$SIZE" "$BASE_SNAPSHOT_ID" "$DO_SSH_KEY_ID" "$DO_REGION")"
trap 'echo "▶ deleting derive droplet $DROPLET_ID"; delete_droplet "$DROPLET_ID"' EXIT

wait_droplet_active "$DROPLET_ID"
IP="$(droplet_public_ip "$DROPLET_ID")"
wait_ssh "$IP"
echo "▶ droplet $DROPLET_ID active at $IP"

# The base snapshot already carries deploy/, but push the current checkout so a derive picks up
# local edits to the zed assets without re-baking the base first.
echo "▶ syncing zed assets"
ssh -o StrictHostKeyChecking=accept-new "root@$IP" 'mkdir -p /srv/composer/app/deploy/zed'
rsync -az --delete ../zed/ "root@$IP:/srv/composer/app/deploy/zed/"

echo "▶ installing KasmVNC + openbox + lavapipe + Zed (a few minutes)"
ssh -o StrictHostKeyChecking=accept-new "root@$IP" 'bash /srv/composer/app/deploy/zed/install-zed.sh'

# Same reason as the base bake: without this, droplets from the snapshot think cloud-init already
# ran and skip their own user_data — the part that writes /etc/oyren/sandbox.env and starts the
# session. Must be last.
echo "▶ resetting cloud-init"
ssh -o StrictHostKeyChecking=accept-new "root@$IP" 'cloud-init clean --logs'

echo "▶ snapshotting as $SNAPSHOT_NAME"
IMAGE_ID="$(snapshot_droplet "$DROPLET_ID" "$SNAPSHOT_NAME")"

echo "✅ zed snapshot ready: $SNAPSHOT_NAME (image id: $IMAGE_ID)"
echo "   Set DROPLET_SNAPSHOT_ID_ZED=$IMAGE_ID in the orchestrator."
echo "   Verify on an xl zed-web session before shipping: stream up at /_oyren/zed/<token>/,"
echo "   type+scroll, measure idle/typing CPU, close browser → zed-editor+Xvnc pids unchanged."
