import { config } from "../config.js";
import { docker } from "./images.js";

/** Ensure the isolated bridge network for task containers exists. */
export async function ensureTaskNetwork(): Promise<void> {
  const nets = await docker.listNetworks({
    filters: { name: [config.taskNetwork] },
  });
  if (nets.some((n) => n.Name === config.taskNetwork)) return;
  await docker.createNetwork({ Name: config.taskNetwork, Driver: "bridge" });
}
