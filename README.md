# script-runner

Remote **MCP server** that launches user-supplied scripts inside disposable Docker
containers and tracks them asynchronously.

An AI client submits a base64 one-liner (plus an optional base64 zip of source
files) and a runtime. The call returns a `task_id` immediately; the script runs in
a separate worker. The client polls for status and gets bounded stdout/stderr tails
so results never overflow its context window.

## Runtimes

| value        | image             |
| ------------ | ----------------- |
| `node24`     | `node:24-slim`    |
| `python3.8`  | `python:3.8-slim` |
| `python3.13` | `python:3.13-slim`|

The one-liner runs in `/workspace`, where the zip (if any) is extracted.

## Transport & auth

Stateless MCP Streamable HTTP at `POST /mcp`. Every request must carry
`Authorization: Bearer <SCRIPT_RUNNER_TOKEN>`. `GET /healthz` is open.

## Tools

- **`run_script`** — `{ runtime, command_base64, zip_base64?, timeout_seconds? }` →
  `{ task_id }`. Enqueues and returns instantly. `timeout_seconds` defaults to 300
  (server-capped).
- **`get_task_status`** — `{ task_id, tail_bytes? }` → `{ state, exit_code, reason,
  runtime_seconds, seconds_since_last_output, stdout_tail, stderr_tail, ... }`.
  `state` ∈ `queued | running | succeeded | failed | killed | timed-out`. Use
  `seconds_since_last_output` to detect a stuck task; `*_truncated` flags mark
  clipped tails.
- **`kill_task`** — `{ task_id }` → stops a queued or running task.

## Safety & limits

Each task runs in its own container: `CapDrop: ALL`, `no-new-privileges`, memory /
CPU / PID caps, and an isolated bridge network (internet reachable, app not). Hard
wall-clock timeouts kill runaways; a reaper enforces timeouts and GCs old task
dirs; on restart, in-flight tasks are marked `killed` and orphan containers removed.

## Local development

```bash
npm install
cp .env.example .env      # set SCRIPT_RUNNER_TOKEN, e.g. openssl rand -hex 32
export TASKS_DIR=$PWD/tasks-data
npm run dev               # requires a local Docker daemon
```

`npm run typecheck` runs `tsc --noEmit`.

## Deployment

A Linux host behind Caddy (automatic TLS). One-time: `deploy/setup-host.sh`.
Each push to `main` triggers `.github/workflows/deploy.yml`, which SSHes in and
runs `deploy/deploy.sh` (`git reset --hard origin/main` +
`docker compose up -d --build`). The bearer token lives only in the host's `.env`.
