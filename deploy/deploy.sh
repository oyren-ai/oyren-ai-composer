#!/usr/bin/env bash
# Idempotent redeploy: pull latest main and rebuild the stack.
set -euo pipefail

APP_DIR="/srv/script-runner/app"
cd "$APP_DIR"

echo "==> Pulling latest main"
git fetch origin main
git reset --hard origin/main

echo "==> Rebuilding and restarting"
docker compose up -d --build

echo "==> Pruning dangling images"
docker image prune -f >/dev/null 2>&1 || true

echo "==> Status"
docker compose ps
