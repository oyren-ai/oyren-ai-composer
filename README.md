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
- **`deploy/bake/`** — the pipeline the `Bake snapshots` workflow runs: bake the golden DO snapshot
  (`bake-base-snapshot.sh`, which carries streamed Zed from `deploy/zed/` and the in-VM browser
  from `deploy/browser/`), derive the Lean variant (`deploy/lean/`), smoke-boot each candidate and
  promote it by rename (`promote-snapshot.sh`), publish the release a live droplet updates from
  (`build-release.sh`, `publish-release.sh`), and register the promoted image with each orchestrator
  (`registerImage.mjs`) so new Codespaces boot it. Every run is one version stamp (UTC
  `YYYY-MM-DD-HHMM`). Taking a bad version out of service is a flag on the orchestrator
  (`pnpm images:prod deactivate --key CODESPACE_BASE --version <v> --reason "..."`), not a rename
  here; a registration that failed after promotion is re-run with the workflow's `register_only`
  input. See `docs/sandbox-updates.md`.
- **`deploy/versions.env`** + **`deploy/manifest/`** — the one place every pin lives, and the image
  manifest (`/etc/oyren/image-manifest.json`) each bake stamps from it: version, family, composer
  sha, every pin, content hashes of the runtime/host/browser trees.
- **`deploy/update/`** — the in-place updater (`oyren-update`): fetch and verify a release, apply
  only the components that changed, restart what moved, roll the runtime back if it does not come
  up. Plus `oyren-quiesce`, run before a session's disk is snapshotted.
- **`deploy/units/`** — the systemd units baked into every droplet, each a no-op until cloud-init
  writes its own `/etc/oyren/*.env`: `oyren-sandbox` (the session runtime), `oyren-tmux` (the
  session's shells and agent, kept apart so a runtime restart leaves them running), `oyren-editor`
  (the browser editor), `oyren-edge` (the route-admin API, on the dedicated edge droplet only),
  `oyren-build` (one-shot image-build VMs).
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
