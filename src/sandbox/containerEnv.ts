/** Decode CONTAINER_ENV_B64 (base64 of a JSON object) into dockerode's ["KEY=value", ...]
 *  shape. Pure — separate from env.ts, which reads (and requires) the process env at import. */
export function decodeContainerEnv(b64: string): string[] {
  if (!b64) return [];
  const parsed: unknown = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CONTAINER_ENV_B64 must decode to a JSON object");
  }
  return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`);
}
