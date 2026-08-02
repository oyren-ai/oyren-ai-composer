import { mkdir, writeFile } from "node:fs/promises";
import extract from "extract-zip";
import { config } from "../config.js";
import { taskDir, workspaceDir, zipPath } from "./paths.js";

/** Decode a base64 zip, enforce the size cap, and persist it to the task dir. */
export async function persistZip(id: string, zipBase64: string): Promise<void> {
  const buf = Buffer.from(zipBase64, "base64");
  if (buf.length === 0) throw new Error("zip_base64 decoded to zero bytes");
  if (buf.length > config.maxZipBytes) {
    const mb = (config.maxZipBytes / 1024 / 1024).toFixed(0);
    throw new Error(`zip exceeds ${mb} MB limit (${buf.length} bytes)`);
  }
  await mkdir(taskDir(id), { recursive: true });
  await writeFile(zipPath(id), buf);
}

/** Extract the persisted zip into the task workspace (extract-zip blocks zip-slip). */
export async function extractZip(id: string): Promise<void> {
  const dir = workspaceDir(id);
  await mkdir(dir, { recursive: true });
  await extract(zipPath(id), { dir });
}
