import { str, num } from "../util/env.js";

/** Edge-mode config, from /etc/oyren/edge.env. The edge is the one always-on host:
 *  Caddy terminates *.SANDBOX_EDGE_DOMAIN with a wildcard cert and reverse-proxies each
 *  hostname to its upstream's private IP. */
export const edgeEnv = {
  /** e.g. "edge.example.com" — every route host must be a direct subdomain of this. */
  domain: str("SANDBOX_EDGE_DOMAIN"),
  /** Bearer token for the route admin API (held by whatever registers routes). */
  adminToken: str("EDGE_ADMIN_TOKEN"),
  port: num("PORT", 3000),
  /** Durable route map (host → upstream), reloaded on boot so routes survive restarts. */
  routesFile: str("ROUTES_FILE", "/etc/oyren/edge-routes.json"),
  /** Rendered Caddy map entries, imported by the Caddyfile's map block. */
  mapFile: str("CADDY_MAP_FILE", "/etc/caddy/oyren-routes.map"),
  caddyConfig: str("CADDY_CONFIG", "/etc/caddy/Caddyfile"),
} as const;
