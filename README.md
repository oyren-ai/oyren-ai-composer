# oyren-ai-composer

Owns everything that runs on an oyren.ai session droplet, end to end: the golden VM snapshot every
session boots from, the browser editor baked into it, the wildcard edge that routes
`*.sandboxes.oyren.ai` to the right droplet, and the one-shot VMs that build/push agent images.

## Layout

- **`sandbox-runtime/`** — the Node process that runs directly on every session droplet: the
  `.oyren-routes.json` / `oyren` CLI reverse-proxy and control API (`/_oyren/control/*`) an agent
  uses to expose a port or manage routes. See `sandbox-runtime/README.md`.
- **`deploy/editor/`** — installs and brands openvscode-server into the snapshot, plus first-party
  extensions (`oyren-preview`, and the `oyren-chat-probe` spike). See `deploy/editor/README.md`.
  Extension sources not in this repo (`oyren-agent-extension`, `oyren-welcome-extension`) come from
  a separate rolling release the fork publishes.
- **`deploy/edge/`** — the wildcard-TLS Caddy host that terminates `*.sandboxes.oyren.ai` and
  proxies each subdomain to its droplet's private IP. See `deploy/edge/README.md`.
- **`deploy/bake/`** — one-time/manual pipeline that bakes the golden DO snapshot
  (`bake-base-snapshot.sh`) session droplets boot from, plus variant derivations (Lean via
  `deploy/lean/`, streamed Zed via `deploy/zed/` — KasmVNC + openbox + lavapipe + a pinned Zed,
  with its `oyren-zed.service` gated on the session env). Not triggered by CI — re-run by hand.
- **`deploy/units/`** — the four systemd units baked into every droplet, each a no-op until
  cloud-init writes its own `/etc/oyren/*.env`: `oyren-sandbox` (the session runtime),
  `oyren-editor` (the browser editor), `oyren-edge` (the route-admin API, on the dedicated edge
  droplet only), `oyren-build` (one-shot image-build VMs).
- **`src/{sandbox,edge,buildjob}/`** + **`src/util/`** — this repo's own TypeScript sources for the
  edge and build service modes (compiled via `tsc -p tsconfig.build.json` into what the systemd
  units above run).
- **`terraform/`** — DigitalOcean infra for a separate self-hosted stack; see `terraform/README.md`.

## Local development

```bash
npm install
npm run typecheck
npm test
```

`npm run sandbox` / `npm run edge` / `npm run buildjob` run each mode's entrypoint directly (each
expects its own `/etc/oyren/*.env`-shaped config — see `src/{sandbox,edge,buildjob}/env.ts`).
