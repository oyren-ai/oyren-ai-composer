/** Decode CONTAINER_ENV_B64 (base64 of a JSON object) into dockerode's ["KEY=value", ...]
 *  shape. Pure — separate from env.ts, which reads (and requires) the process env at import. */
const MAX_DECODED_BYTES = 64 * 1024;

export function decodeContainerEnv(b64: string): string[] {
  if (!b64) return [];
  // A ~43KB base64 string already decodes to the 32KB cap on the JSON body; double-check here so
  // an oversized value can't blow up the container bootstrap via a giant Buffer allocation.
  if (b64.length > MAX_DECODED_BYTES) throw new Error("CONTAINER_ENV_B64 exceeds the size limit");
  const parsed: unknown = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CONTAINER_ENV_B64 must decode to a JSON object");
  }
  return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`);
}
