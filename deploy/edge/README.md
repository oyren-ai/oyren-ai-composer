# Edge mode: wildcard TLS reverse proxy with a route admin API

Caddy terminates `https://*.$SANDBOX_EDGE_DOMAIN` with a single wildcard certificate
and reverse-proxies each hostname to a private upstream (`IPv4:port`). Routes are
managed at runtime through a small bearer-authed admin API.

## How routing works

- `oyren-edge.service` runs the admin API (`src/edge/`) on `:3000`.
- Routes live in `/etc/oyren/edge-routes.json` (durable) and are rendered to
  `/etc/caddy/oyren-routes.map` as Caddy `map` entries (`host upstream` per line).
- The Caddyfile's `map` block `import`s that file; every route change rewrites it and runs
  `caddy reload --config /etc/caddy/Caddyfile`. On boot the service re-renders + reloads,
  so routes survive restarts. WebSockets pass through `reverse_proxy` untouched.

## Admin API (bearer `EDGE_ADMIN_TOKEN`; `GET /healthz` open)

```bash
curl -X PUT  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
     -d '{"upstream":"10.0.0.7:8080"}' http://EDGE:3000/routes/abc.edge.example.com
curl -X DELETE -H "Authorization: Bearer $T" http://EDGE:3000/routes/abc.edge.example.com
curl -H "Authorization: Bearer $T" http://EDGE:3000/routes
```

Hosts must be a single label directly under `SANDBOX_EDGE_DOMAIN`; upstreams must be
`IPv4:port`. Anything else is a 400.

## One-time manual setup (not baked, not automated)

1. **DNS**: point `*.<your edge domain>` (A record) at this host's public IP.
2. **Wildcard cert via DNS-01**: a wildcard cannot use HTTP-01. Install a Caddy build with
   your DNS provider module (`github.com/caddy-dns/*`, via `caddy add-package` or xcaddy),
   then replace the `dns REPLACE_ME_...` line in `deploy/edge/Caddyfile` with the provider
   block and its DNS API credentials. Copy the file to `/etc/caddy/Caddyfile`.
3. `touch /etc/caddy/oyren-routes.map` (empty is fine), write `/etc/oyren/edge.env` with
   `SANDBOX_EDGE_DOMAIN` + `EDGE_ADMIN_TOKEN` (+ optional `PORT`), then
   `systemctl restart caddy oyren-edge`.
4. Firewall: expose 80/443 publicly; restrict `:3000` to the hosts that register routes.
