#!/usr/bin/env bash
# SOURCE this file after lib.sh. The DigitalOcean image calls the promote step needs on top of the
# bake helpers: rename (promotion is a rename from `candidate-…` to the name the orchestrator's
# catalog looks for; rollback is a rename to `retired-…`), delete (a candidate that failed its smoke
# boot), and a droplet create that carries cloud-init user_data (the smoke boot has to prove the
# image processes a session's user_data, which is exactly what `cloud-init clean` at bake end
# protects).

# rename_image <image-id> <new-name>
rename_image() {
  do_api PUT "/images/$1" "$(jq -n --arg n "$2" '{name:$n}')" | jq -r '.image.name'
}

# delete_image <image-id> — best-effort; used on a failed smoke boot and from traps.
delete_image() {
  do_api DELETE "/images/$1" >/dev/null 2>&1 || true
}

# image_name <image-id> — the current name, or empty when the image is gone.
image_name() {
  do_api GET "/images/$1" 2>/dev/null | jq -r '.image.name // empty'
}

# create_droplet_with_user_data <name> <size> <image> <ssh_key_id> <region> <user_data-file>
# Like lib.sh's create_droplet, plus a cloud-init document. Prints the new droplet's id.
create_droplet_with_user_data() {
  local name="$1" size="$2" image="$3" key="$4" region="$5" user_data_file="$6" body resp id
  body="$(jq -n --arg n "$name" --arg s "$size" --arg i "$image" --arg k "$key" --arg r "$region" \
    --rawfile u "$user_data_file" \
    '{name:$n, size:$s, image:($i|tonumber? // $i), region:$r, ssh_keys:[($k|tonumber? // $k)], tags:["oyren-bake"], user_data:$u}')"
  resp="$(curl -sS -X POST -H "Authorization: Bearer $DO_API_TOKEN" \
    -H "Content-Type: application/json" -d "$body" "$DO_API/droplets")"
  id="$(printf '%s' "$resp" | jq -r '.droplet.id // empty')"
  if [ -z "$id" ]; then
    echo "ERROR: droplet create failed: $(printf '%s' "$resp" | jq -r '.message // .' | head -c 300)" >&2
    return 1
  fi
  printf '%s\n' "$id"
}
