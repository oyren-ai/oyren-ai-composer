#!/usr/bin/env bash
# Add streamed Zed (KasmVNC + openbox + Zed) to a sandbox droplet, producing the ZED snapshot
# variant — run remotely by deploy/bake/derive-zed-snapshot.sh, mirroring deploy/lean/install-lean.sh.
#
# This is NOT part of the base bake: the stack is ~1.5GB that only streamed-Zed sessions use, and
# the base image's disk floor matters for every other launch. Everything else (runtime, agents,
# editor) is already in the base snapshot, which is why deriving is cheap.
#
# Idempotent: safe to re-run. Runs as root on a droplet booted from the base snapshot.
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
