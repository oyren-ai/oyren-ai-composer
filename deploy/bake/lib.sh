#!/usr/bin/env bash
# Shared DigitalOcean helpers for the droplet snapshot bake scripts (sandbox-droplet-snapshot/
# and build-droplet-snapshot/). SOURCE this file — never execute it. Each bake script boots a
# throwaway droplet, provisions it over SSH, powers it off, snapshots it and deletes it; all the
# DO API plumbing lives here so the two bake scripts stay tiny and can't drift apart.
#
# Requires curl + jq on the machine running the bake. Env:
#   DO_API_TOKEN   (required) DigitalOcean API token with write access
#   DO_SSH_KEY_ID  (required) id or fingerprint of an SSH key already uploaded to DO — the bake
#                  droplet must be SSH-able as root for provisioning
#   DO_REGION      (optional) defaults to fra1, same region the orchestrator uses

# Fail fast with a clear message: a missing tool or token would otherwise surface as a cryptic
# curl/jq error halfway through a bake, possibly with a half-created droplet left billing.
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required" >&2; exit 1; }
: "${DO_API_TOKEN:?must be set (DigitalOcean API token with write access)}"
: "${DO_SSH_KEY_ID:?must be set (uploaded SSH key id, so the bake droplet is reachable)}"
DO_REGION="${DO_REGION:-fra1}"
DO_API="https://api.digitalocean.com/v2"

# do_api <METHOD> <path> [json-body] — curl wrapper for the DO API; prints the response body.
do_api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" -H "Authorization: Bearer $DO_API_TOKEN" \
      -H "Content-Type: application/json" -d "$body" "$DO_API$path"
  else
    curl -fsS -X "$method" -H "Authorization: Bearer $DO_API_TOKEN" "$DO_API$path"
  fi
}

# create_droplet <name> <size> <image> <ssh_key_id> <region> — prints the new droplet's id.
# tonumber? lets DO_SSH_KEY_ID be either a numeric id or a fingerprint (DO accepts both).
create_droplet() {
  local name="$1" size="$2" image="$3" key="$4" region="$5"
  do_api POST /droplets "$(jq -n --arg n "$name" --arg s "$size" --arg i "$image" \
    --arg k "$key" --arg r "$region" \
    '{name:$n, size:$s, image:$i, region:$r, ssh_keys:[($k|tonumber? // $k)], tags:["oyren-bake"]}')" \
    | jq -r '.droplet.id'
}

# wait_droplet_active <id> — poll until the droplet reports "active" (~5 min cap: 60 x 5s).
wait_droplet_active() {
  local id="$1" i
  for i in $(seq 1 60); do
    [ "$(do_api GET "/droplets/$id" | jq -r '.droplet.status')" = "active" ] && return 0
    sleep 5
  done
  echo "ERROR: droplet $id not active after 5 minutes" >&2
  return 1
}

# droplet_public_ip <id> — prints the droplet's public IPv4 address.
droplet_public_ip() {
  do_api GET "/droplets/$1" \
    | jq -r '.droplet.networks.v4[] | select(.type == "public") | .ip_address' | head -n 1
}

# wait_ssh <ip> — retry until sshd accepts connections: DO reports "active" well before the
# box does. accept-new: bake droplets are brand-new hosts, prompts are noise.
wait_ssh() {
  local ip="$1" i
  for i in $(seq 1 30); do
    ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes \
      "root@$ip" true 2>/dev/null && return 0
    sleep 10
  done
  echo "ERROR: ssh to $ip never came up" >&2
  return 1
}

# run_remote <ip> <script-path> — stream a local script into `bash -s` as root on the droplet
# (nothing is copied to its disk).
run_remote() {
  local ip="$1" script="$2"
  wait_ssh "$ip"
  ssh -o StrictHostKeyChecking=accept-new "root@$ip" 'bash -s' < "$script"
}

# snapshot_droplet <id> <name> — power off first (snapshotting a running disk risks an
# inconsistent image), snapshot, wait for completion, then print the new snapshot's image id.
snapshot_droplet() {
  local id="$1" name="$2" action status i
  do_api POST "/droplets/$id/actions" '{"type":"power_off"}' >/dev/null
  for i in $(seq 1 60); do
    [ "$(do_api GET "/droplets/$id" | jq -r '.droplet.status')" = "off" ] && break
    [ "$i" -eq 60 ] && { echo "ERROR: droplet $id never powered off" >&2; return 1; }
    sleep 5
  done
  action="$(do_api POST "/droplets/$id/actions" \
    "$(jq -n --arg n "$name" '{type:"snapshot", name:$n}')" | jq -r '.action.id')"
  for i in $(seq 1 180); do # snapshots of a ~5GB-used disk take minutes; cap at ~30
    status="$(do_api GET "/droplets/$id/actions/$action" | jq -r '.action.status')"
    [ "$status" = "completed" ] && break
    [ "$status" = "errored" ] && { echo "ERROR: snapshot action $action errored" >&2; return 1; }
    [ "$i" -eq 180 ] && { echo "ERROR: snapshot not done after 30 minutes" >&2; return 1; }
    sleep 10
  done
  do_api GET "/droplets/$id/snapshots" \
    | jq -r --arg n "$name" '.snapshots[] | select(.name == $n) | .id' | tail -n 1
}

# delete_droplet <id> — best-effort teardown; called from EXIT traps, so it must never abort.
delete_droplet() {
  do_api DELETE "/droplets/$1" >/dev/null 2>&1 || true
}
