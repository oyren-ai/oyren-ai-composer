import express from "express";
import { edgeEnv } from "./env.js";
import { bearerAuth } from "../util/bearer.js";
import { loadRoutes, saveRoutes, isValidHost, isValidUpstream, type RouteMap } from "./routes.js";
import { applyRoutes } from "./caddy.js";

/** Edge-mode entrypoint (systemd: oyren-edge.service): the route admin API callers hit
 *  when an upstream VM comes up (PUT) or is torn down (DELETE). Routes persist to
 *  disk and are re-applied to Caddy on boot. */
async function main(): Promise<void> {
  let routes: RouteMap = await loadRoutes(edgeEnv.routesFile);
  await applyRoutes(routes, edgeEnv.mapFile, edgeEnv.caddyConfig).catch((err) =>
    console.error(`boot route apply failed (caddy not up yet?): ${(err as Error).message}`),
  );

  const app = express();
  app.use(express.json({ limit: "16kb" }));
  const auth = bearerAuth(edgeEnv.adminToken);

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/routes", auth, (_req, res) => {
    res.json(routes);
  });

  const save = async (next: RouteMap, res: express.Response, onOk: () => void): Promise<void> => {
    await saveRoutes(edgeEnv.routesFile, next);
    try {
      await applyRoutes(next, edgeEnv.mapFile, edgeEnv.caddyConfig);
    } catch (err) {
      routes = next; // persisted — boot/next change re-applies it
      res.status(502).json({ error: `route saved but caddy reload failed: ${(err as Error).message}` });
      return;
    }
    routes = next;
    onOk();
  };

  app.put("/routes/:host", auth, (req, res) => {
    const host = String(req.params.host ?? "");
    const upstream: unknown = (req.body as { upstream?: unknown } | undefined)?.upstream;
    if (!isValidHost(host, edgeEnv.domain)) {
      res.status(400).json({ error: `host must be a direct subdomain of ${edgeEnv.domain}` });
      return;
    }
    if (typeof upstream !== "string" || !isValidUpstream(upstream)) {
      res.status(400).json({ error: "upstream must be \"IPv4:port\"" });
      return;
    }
    void save({ ...routes, [host]: upstream }, res, () => res.json({ host, upstream }));
  });

  app.delete("/routes/:host", auth, (req, res) => {
    const host = String(req.params.host ?? "");
    const { [host]: _removed, ...rest } = routes;
    void save(rest, res, () => res.status(204).end());
  });

  // Loopback only: Caddy fronts this API on admin.<domain> and reverse_proxies to
  // 127.0.0.1:<port> (deploy/edge/Caddyfile). Listening on all interfaces would expose the
  // route-admin API (bearer-gated, but unrate-limited) and the full host→IP map to any VPC
  // peer — including the SSRF/takeover path via a possibly-leaked or weak token.
  app.listen(edgeEnv.port, "127.0.0.1", () =>
    console.log(`edge admin API on 127.0.0.1:${edgeEnv.port} (domain=${edgeEnv.domain})`),
  );
}

main().catch((err) => {
  console.error(`edge mode fatal: ${(err as Error).message}`);
  process.exit(1);
});
