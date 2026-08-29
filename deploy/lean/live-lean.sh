#!/usr/bin/env bash
# Move the Lean toolchain on a LIVE lean droplet to the pin in template/lean-toolchain, and refresh
# the Lean skills in the runtime tree. install-lean.sh is not safe here: it copies the project
# template over ~/workspace/lean, which by now is the user's project, and rebuilds Mathlib for
# minutes as that user. So this only teaches elan the new default and leaves the project alone —
# the project's own lean-toolchain file still decides what `lake` runs inside it.
#
# A non-lean image has no elan and nothing to do (exit 0, no stamp). Runs as root.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_USER="${SANDBOX_USER:-oyren}"
USER_HOME="$(getent passwd "$SANDBOX_USER" | cut -d: -f6)"
TOOLCHAIN="$(tr -d '[:space:]' < "$HERE/template/lean-toolchain")"

if [ ! -x "$USER_HOME/.elan/bin/elan" ]; then
  echo "==> lean: no elan on this image (not a lean image); nothing to do"
  exit 0
fi

echo "==> lean: toolchain ${TOOLCHAIN} (elan default; the project keeps its own pin)"
su - "$SANDBOX_USER" -c "export PATH=\"\$HOME/.elan/bin:\$PATH\" && elan toolchain install '$TOOLCHAIN' && elan default '$TOOLCHAIN'"

echo "==> lean: skills -> /app/skills"
mkdir -p /app/skills
cp -a "$HERE/skills/." /app/skills/
chown -R "$SANDBOX_USER:$SANDBOX_USER" /app/skills

cat > /etc/profile.d/30-oyren-lean.sh <<EOF
export ELAN_HOME="${USER_HOME}/.elan"
export PATH="\$ELAN_HOME/bin:\$PATH"
EOF
chmod 0644 /etc/profile.d/30-oyren-lean.sh

"$HERE/../manifest/stamp.sh" lean "$TOOLCHAIN"
echo "✅ lean toolchain ${TOOLCHAIN} is elan's default"
