#!/usr/bin/env bash
# Add streamed Zed (KasmVNC + openbox + Zed) to a sandbox droplet. Part of the BASE bake now
# (deploy/bake-install.sh), not a derived variant.
#
# It was a variant while a session's editor was fixed at launch. Now that a session can switch
# between streamed Zed and the browser editor while it runs (editorSurface.js), both have to be in
# whatever image it booted from. The stack is ~1.5GB inside the base's ~13.5GB headroom on the same
# 25GB bake droplet, so the image's droplet floor does not move; deriving bought a smaller image at
# the cost of a second thing to bake and a variant that lagged the base by a derive.
#
# Idempotent: safe to re-run. Runs as root during the bake.
set -euo pipefail

SANDBOX_USER="${SANDBOX_USER:-oyren}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_HOME="$(getent passwd "$SANDBOX_USER" | cut -d: -f6)"

bash "$HERE/install-zed-stack.sh"

# The launcher imports sessionEnv.mjs relatively, so it must live in the same dir the base bake
# installed the other launchers into (install-runtime.sh). A base image predating the runtime
# cannot host it — fail the derive rather than snapshot a broken unit.
echo "==> launcher -> /usr/local/lib/oyren"
[ -f /usr/local/lib/oyren/sessionEnv.mjs ] \
  || { echo "ERROR: /usr/local/lib/oyren/sessionEnv.mjs missing — base snapshot predates the runtime installer" >&2; exit 1; }
install -m 0755 "$HERE/start-zed.mjs" /usr/local/lib/oyren/start-zed.mjs
install -m 0644 "$HERE/zedStack.mjs" /usr/local/lib/oyren/zedStack.mjs
install -D -m 0644 "$HERE/rc.xml" /etc/oyren/zed/rc.xml

# Unit + the Wants= drop-in that hooks it into oyren-sandbox.service without a base re-bake.
# NO systemctl enable — the unit has no [Install] section by design (see its header).
echo "==> oyren-zed.service + oyren-sandbox drop-in"
install -m 0644 "$HERE/oyren-zed.service" /etc/systemd/system/oyren-zed.service
install -D -m 0644 "$HERE/10-zed.conf" /etc/systemd/system/oyren-sandbox.service.d/10-zed.conf
systemctl daemon-reload

# auto_update:false is load-bearing — Zed self-updates by default, which would silently drift the
# pinned build on long-lived droplets. restore_on_startup:none — every session is a fresh droplet;
# a restored stale project list would just confuse the stream.
echo "==> seeding Zed settings for $SANDBOX_USER"
install -d -o "$SANDBOX_USER" -g "$SANDBOX_USER" "$USER_HOME/.config" "$USER_HOME/.config/zed"
cat > "$USER_HOME/.config/zed/settings.json" <<'EOF'
{
  "auto_update": false,
  "telemetry": { "diagnostics": false, "metrics": false },
  "restore_on_startup": "none"
}
EOF
chown "$SANDBOX_USER:$SANDBOX_USER" "$USER_HOME/.config/zed/settings.json"

echo "✅ streamed Zed installed — snapshot this droplet as the zed variant"
