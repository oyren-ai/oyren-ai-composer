import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

export type RouteMap = Record<string, string>;

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const UPSTREAM = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/;

/** A valid route host is exactly one label under the edge domain (what *.domain covers). */
export function isValidHost(host: string, domain: string): boolean {
  if (!host.endsWith(`.${domain}`)) return false;
  const label = host.slice(0, -(domain.length + 1));
  return LABEL.test(label);
}

/** Upstreams are pinned to IPv4:port — callers register VM private IPs, never names. */
export function isValidUpstream(upstream: string): boolean {
  const m = UPSTREAM.exec(upstream);
  if (!m) return false;
  const octets = [m[1], m[2], m[3], m[4]].map(Number);
  const port = Number(m[5]);
  return octets.every((o) => o <= 255) && port >= 1 && port <= 65535;
}

export async function loadRoutes(path: string): Promise<RouteMap> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  } catch {
    return {}; // absent or corrupt file ⇒ start empty (routes re-register on relaunch)
  }
}

/** Atomic write (tmp + rename) so a crash mid-save can't leave a truncated route file. */
export async function saveRoutes(path: string, routes: RouteMap): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(routes, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}
