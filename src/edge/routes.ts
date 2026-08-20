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

/** Upstreams are pinned to private (RFC1918) or CGNAT IPv4:port — callers register VM private IPs.
 *  Loopback, link-local/metadata (e.g. AWS/DO 169.254.169.254), multicast and public ranges are
 *  rejected so a route can never be pointed at the host itself, a VPC peer's metadata endpoint,
 *  or an external host (SSRF via the edge's wildcard reverse proxy). */
export function isValidUpstream(upstream: string): boolean {
  const m = UPSTREAM.exec(upstream);
  if (!m) return false;
  const octets = [m[1], m[2], m[3], m[4]].map(Number);
  const port = Number(m[5]);
  if (!octets.every((o) => o <= 255)) return false;
  if (port < 1 || port > 65535) return false;
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  const rfc1918 = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  const cgnat = a === 100 && b >= 64 && b <= 127;
  return rfc1918 || cgnat;
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
