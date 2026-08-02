import Docker from "dockerode";
import type { Runtime } from "../tasks/types.js";

export const docker = new Docker();

const IMAGES: Record<Runtime, string> = {
  node24: "node:24-slim",
  "python3.8": "python:3.8-slim",
  "python3.13": "python:3.13-slim",
};

export function imageFor(runtime: Runtime): string {
  return IMAGES[runtime];
}

export function allImages(): string[] {
  return Object.values(IMAGES);
}

/** Pull the image if it is not already present locally. */
export async function ensureImage(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    // not present; pull below
  }
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
  });
}
