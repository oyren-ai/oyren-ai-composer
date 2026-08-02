#!/usr/bin/env bash
# One-time host bootstrap for script-runner. Run as root over SSH.
set -euo pipefail

REPO="git@github.com:oyren-ai/oyren-ai-composer.git"
APP_DIR="/srv/script-runner/app"
TASKS_DIR="/srv/script-runner/tasks"

echo "==> Ensuring Docker + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || {
  apt-get update && apt-get install -y docker-compose-plugin
}

echo "==> Creating directories"
mkdir -p "$TASKS_DIR" "$(dirname "$APP_DIR")"

echo "==> Deploy key (add the printed key to the repo's Deploy Keys, read-only)"
if [ ! -f /root/.ssh/id_ed25519 ]; then
  ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519 -C "script-runner-deploy"
fi
ssh-keyscan github.com >>/root/.ssh/known_hosts 2>/dev/null || true
echo "----- DEPLOY PUBLIC KEY -----"; cat /root/.ssh/id_ed25519.pub; echo "-----------------------------"

echo "==> Cloning repo (skip if the deploy key is not yet added)"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR" || echo "clone failed — add the deploy key above, then re-run"
fi

echo "==> Writing .env if absent"
if [ ! -f "$APP_DIR/.env" ] && [ -d "$APP_DIR" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  TOKEN=$(openssl rand -hex 32)
  sed -i "s/^SCRIPT_RUNNER_TOKEN=.*/SCRIPT_RUNNER_TOKEN=$TOKEN/" "$APP_DIR/.env"
  echo "Generated SCRIPT_RUNNER_TOKEN: $TOKEN"
fi

echo "==> Pre-pulling runtime images"
for img in node:24-slim python:3.8-slim python:3.13-slim; do docker pull "$img"; done

echo "==> Setup complete. Deploy with: bash $APP_DIR/deploy/deploy.sh"
