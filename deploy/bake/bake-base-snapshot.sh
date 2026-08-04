#!/usr/bin/env bash
# Bake the BASE sandbox snapshot: the golden image every session droplet boots from.
#
# Contains Docker CE (for the AGENT's own builds — the session itself is no longer containerised),
# the composer checkout at /srv/composer/app, every agent CLI, the session runtime at /app, and the
# branded Oyren editor. The Lean variant is derived from this image afterwards — see
# derive-lean-snapshot.sh, and deploy/lean/install-lean.sh for why Mathlib is not baked in here.
#
# Lives in composer (not deployable-containers) because composer owns everything that runs on the
# droplet; the container images this replaces are on their way out.
#
# Re-bake cadence: manual. Re-run whenever agent CLI pins, the runtime, or OS/Docker patches should
# reach new droplets. Cost: one s-1vcpu-1gb droplet for ~15 minutes.
#
# Usage: DO_API_TOKEN=... DO_SSH_KEY_ID=... [DO_REGION=fra1] ./bake-base-snapshot.sh
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh

COMPOSER_DIR="$(cd ../.. && pwd)"
NAME="oyren-bake-sandbox-$(date +%s)"
SNAPSHOT_NAME="oyren-sandbox-droplet-$(date -u +%Y-%m-%d-%H%M)"

# Bake on the SMALLEST disk (s-1vcpu-1gb = 25GB): DO refuses to boot an image onto a droplet with a
# smaller disk than the image was made on, so the bake size sets the MINIMUM session droplet size.
# Its 1GB of RAM is why the installers raise V8's heap ceiling — see install-agents.sh.
echo "▶ creating bake droplet $NAME in $DO_REGION"
DROPLET_ID="$(create_droplet "$NAME" s-1vcpu-1gb ubuntu-24-04-x64 "$DO_SSH_KEY_ID" "$DO_REGION")"
# Delete the temp droplet no matter how this ends — a leaked bake droplet bills forever.
trap 'echo "▶ deleting bake droplet $DROPLET_ID"; delete_droplet "$DROPLET_ID"' EXIT

wait_droplet_active "$DROPLET_ID"
IP="$(droplet_public_ip "$DROPLET_ID")"
wait_ssh "$IP"
echo "▶ droplet $DROPLET_ID active at $IP"

# Push this checkout rather than cloning: it keeps the bake working while the repo is private, and
# lets a bake test local edits before they are pushed. Retried — sshd is restarted by cloud-init
# moments after it first accepts connections, which killed a bake here.
echo "▶ pre-placing composer checkout"
retry 5 10 ssh -o StrictHostKeyChecking=accept-new "root@$IP" 'mkdir -p /srv/composer/app'
retry 5 10 rsync -az --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude tasks-data \
  --exclude .env --exclude .idea --exclude .claude \
  "$COMPOSER_DIR"/ "root@$IP:/srv/composer/app/"

echo "▶ provisioning"
retry 3 15 run_remote "$IP" ./provision-remote.sh

# cloud-init clean LAST, after all provisioning — critical. Without it, droplets booted from the
# snapshot believe cloud-init already ran and SKIP their own user_data, which is the part that
# writes /etc/oyren/sandbox.env and starts the session.
echo "▶ resetting cloud-init so snapshot boots process their own fresh user_data"
retry 3 5 ssh -o StrictHostKeyChecking=accept-new "root@$IP" 'cloud-init clean --logs'

echo "▶ snapshotting as $SNAPSHOT_NAME (powers off first; takes a few minutes)"
IMAGE_ID="$(snapshot_droplet "$DROPLET_ID" "$SNAPSHOT_NAME")"

echo "✅ base snapshot ready: $SNAPSHOT_NAME (image id: $IMAGE_ID)"
echo "   Set DROPLET_SNAPSHOT_ID=$IMAGE_ID in the orchestrator."
echo "   Then: BASE_SNAPSHOT_ID=$IMAGE_ID ./derive-lean-snapshot.sh  for the Lean variant."