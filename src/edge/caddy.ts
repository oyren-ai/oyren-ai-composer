import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { RouteMap } from "./routes.js";

const exec = promisify(execFile);

/** Render the routes as Caddy `map` entries ("host upstream" lines). The Caddyfile's map
 *  block `import`s this file, so a rewrite + reload is the whole routing update. */
export function renderMap(routes: RouteMap): string {
  const lines = Object.entries(routes).map(([host, upstream]) => `${host} ${upstream}`);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** Write the map file atomically and reload Caddy. Reload failures are surfaced to the caller
 *  (the admin API returns 502) — the JSON route store is already saved, so a later reload or
 *  boot re-applies the route; nothing is lost. */
export async function applyRoutes(routes: RouteMap, mapFile: string, caddyConfig: string): Promise<void> {
  await mkdir(dirname(mapFile), { recursive: true });
  const tmp = `${mapFile}.tmp`;
  await writeFile(tmp, renderMap(routes), "utf8");
  await rename(tmp, mapFile);
  await exec("caddy", ["reload", "--config", caddyConfig]);
}
