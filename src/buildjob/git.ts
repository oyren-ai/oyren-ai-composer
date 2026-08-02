import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";

const exec = promisify(execFile);

/** Insert https token auth into a clone URL (GitHub's x-access-token convention). */
export function authedUrl(url: string, token: string): string {
  if (!token || !url.startsWith("https://")) return url;
  return `https://x-access-token:${token}@${url.slice("https://".length)}`;
}

/** Strip the token from any text that might surface in logs/errors (git errors echo the URL). */
export function scrub(text: string, token: string): string {
  return token ? text.split(token).join("***") : text;
}

/** Clone `url` at `ref` into `dir` (fresh — the dir is removed first). Tries the cheap
 *  shallow-branch clone; a ref that isn't a branch/tag (e.g. a commit sha) falls back to a
 *  full clone + checkout. Errors are rethrown with the token scrubbed. */
export async function cloneAtRef(url: string, ref: string, token: string, dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  const remote = authedUrl(url, token);
  try {
    await exec("git", ["clone", "--depth", "1", "--branch", ref, remote, dir]);
    return;
  } catch {
    // ref may be a sha — shallow --branch only takes branch/tag names
  }
  try {
    await exec("git", ["clone", remote, dir]);
    await exec("git", ["-C", dir, "checkout", ref]);
  } catch (err) {
    throw new Error(`git clone failed: ${scrub((err as Error).message, token)}`);
  }
}
