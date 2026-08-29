#!/usr/bin/env bash
# Smoke-boot a freshly baked `candidate-…` snapshot and promote it by renaming it to the name the
# orchestrator's catalog looks for (`oyren-sandbox-<family>-<version>`). A candidate that fails is
# deleted, so a broken bake can never become the newest image. Rollback later is a rename to
# `retired-oyren-sandbox-…`.
#
#   IMAGE_ID=… FAMILY=base RELEASE_VERSION=2026-08-25-1838 ./promote-snapshot.sh
#
# The smoke boot is a real session boot in miniature: a droplet from the candidate with a minimal
# cloud-init user_data (a sandbox.env whose tokens are "smoke" and no editor), then
# /_oyren/health over ssh must answer with this bake's imageVersion. That proves cloud-init
# processed fresh user_data (the failure mode bake-base-snapshot.sh guards with `cloud-init clean`),
# the unit started, node-pty loaded, and the manifest is the one we meant to ship.
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh
source ./lib-images.sh

: "${IMAGE_ID:?must be set (the candidate image id)}"
: "${FAMILY:?must be set (base|lean)}"
: "${RELEASE_VERSION:?must be set (the version stamp of this bake)}"
FINAL_NAME="oyren-sandbox-$FAMILY-$RELEASE_VERSION"

USER_DATA="$(mktemp)"
ENV_B64="$(printf '%s' '{"SESSION_TOKEN":"smoke","CONTROL_TOKEN":"smoke","OYREN_EDITOR":"0","OYREN_ZED":"0"}' | base64 | tr -d '\n')"
cat > "$USER_DATA" <<EOF
#cloud-config
write_files:
  - path: /etc/oyren/sandbox.env
    permissions: '0600'
    owner: root:root
    content: |
      SANDBOX_IMAGE=smoke
      CONTAINER_PORT=8080
      CONTAINER_ENV_B64=$ENV_B64
runcmd:
  - systemctl start oyren-sandbox
EOF

NAME="oyren-smoke-$FAMILY-$(date +%s)"
echo "▶ smoke-booting candidate $IMAGE_ID as $NAME"
DROPLET_ID="$(create_droplet_with_user_data "$NAME" s-1vcpu-1gb "$IMAGE_ID" "$DO_SSH_KEY_ID" "$DO_REGION" "$USER_DATA")"
trap 'echo "▶ deleting smoke droplet $DROPLET_ID"; delete_droplet "$DROPLET_ID"; rm -f "$USER_DATA"' EXIT

wait_droplet_active "$DROPLET_ID"
IP="$(droplet_public_ip "$DROPLET_ID")"
wait_ssh "$IP"

# The runtime needs a minute after first boot (cloud-init, then the unit). Poll health through ssh
# so no firewall assumption is baked into the check; the answer must carry OUR version.
health() { ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes "root@$IP" 'curl -fsS localhost:8080/_oyren/health'; }
GOT=""
for i in $(seq 1 24); do
  GOT="$(health 2>/dev/null || true)"
  [ -n "$GOT" ] && break
  sleep 10
done
VERSION_SEEN="$(printf '%s' "$GOT" | jq -r '.imageVersion // empty' 2>/dev/null || true)"
if [ "$VERSION_SEEN" != "$RELEASE_VERSION" ]; then
  echo "ERROR: smoke boot of $IMAGE_ID failed: health answered '${GOT:-nothing}' (wanted imageVersion $RELEASE_VERSION)" >&2
  ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes "root@$IP" 'systemctl status oyren-sandbox --no-pager | tail -n 20; journalctl -u oyren-sandbox --no-pager | tail -n 40' 2>/dev/null || true
  echo "▶ deleting failed candidate $IMAGE_ID"
  delete_image "$IMAGE_ID"
  exit 1
fi
echo "  health ok: $GOT"

echo "▶ promoting $IMAGE_ID → $FINAL_NAME"
rename_image "$IMAGE_ID" "$FINAL_NAME" >/dev/null
echo "✅ promoted: $FINAL_NAME (image id: $IMAGE_ID)"
