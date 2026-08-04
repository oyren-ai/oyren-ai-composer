# Edge mode: wildcard TLS reverse proxy with a route admin API

Caddy terminates `https://*.$SANDBOX_EDGE_DOMAIN` with a single wildcard certificate
and reverse-proxies each hostname to a private upstream (`IPv4:port`). Routes are
managed at runtime through a small bearer-authed admin API.

This host is what gives droplet-backed sandboxes a public URL, so it is a hard dependency of
`SANDBOX_BACKEND=droplet` in the orchestrator (its default). If the edge is down, launches provision
and then never go active.

## How routing works

- `oyren-edge.service` runs the admin API (`src/edge/`) on `:3000`.
- Routes live in `/etc/oyren/edge-routes.json` (durable) and are rendered to
  `/etc/caddy/oyren-routes.map` as Caddy `map` entries (`host upstream` per line).
- The Caddyfile's `map` block `import`s that file; every route change rewrites it and runs
  `caddy reload --config /etc/caddy/Caddyfile`. On boot the service re-renders + reloads,
  so routes survive restarts. WebSockets pass through `reverse_proxy` untouched.
- `admin.$SANDBOX_EDGE_DOMAIN` is a **separate site block** proxying to `127.0.0.1:3000`. It cannot
  be served by the wildcard: the admin host is never in the route map, so it would hit the 404
  responder and the orchestrator could never register a route.

## Admin API (bearer `EDGE_ADMIN_TOKEN`; `GET /healthz` open)

```bash
curl -X PUT  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
     -d '{"upstream":"10.0.0.7:8080"}' https://admin.edge.example.com/routes/abc.edge.example.com
curl -X DELETE -H "Authorization: Bearer $T" https://admin.edge.example.com/routes/abc.edge.example.com
curl -H "Authorization: Bearer $T" https://admin.edge.example.com/routes
```

Hosts must be a single label directly under `SANDBOX_EDGE_DOMAIN`; upstreams must be
`IPv4:port`. Anything else is a 400.

## One-time manual setup (not baked, not automated)

1. **DNS** (DO DNS, zone `oyren.ai`): point both `*.<edge domain>` and `admin.<edge domain>` at this
   host's public IP with A records.

2. **Caddy build with the DigitalOcean DNS module** — a wildcard cert cannot use HTTP-01:

   ```bash
   caddy add-package github.com/caddy-dns/digitalocean   # or: xcaddy build --with github.com/caddy-dns/digitalocean
   ```

3. **Env.** Write `/etc/oyren/edge.env`:

   ```
   SANDBOX_EDGE_DOMAIN=sandboxes.oyren.ai
   EDGE_ADMIN_TOKEN=<same value as the orchestrator's EDGE_ADMIN_TOKEN>
   EDGE_DO_API_KEY=<DO API token with DNS write — this is what EDGE_DO_API_KEY in the
                    orchestrator's env is for; no orchestrator code reads it>
   ```

   Caddy substitutes `{$VAR}` from **its own** environment, not `oyren-edge.service`'s, so give
   `caddy.service` the same file:

   ```bash
   systemctl edit caddy    # add:  [Service]\nEnvironmentFile=/etc/oyren/edge.env
   ```

4. **Install + start.** `cp deploy/edge/Caddyfile /etc/caddy/Caddyfile`,
   `touch /etc/caddy/oyren-routes.map` (empty is fine), then
   `systemctl daemon-reload && systemctl restart caddy oyren-edge`.

5. **Firewall.** Expose 80/443 publicly. `:3000` needs no public exposure at all — it is reached
   through Caddy on `admin.<domain>`, so bind it to loopback and leave the port closed.

## Verify

```bash
curl -sf https://admin.<edge domain>/healthz                                  # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' https://nothing-here.<edge domain>   # 404 "unknown host"
curl -H "Authorization: Bearer $T" https://admin.<edge domain>/routes         # {} before any launch
```

A 404 from `/healthz` means the admin site block is missing and the wildcard swallowed the request.
