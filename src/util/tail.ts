import { open } from "node:fs/promises";

export interface Tail {
  text: string;
  truncated: boolean;
  totalBytes: number;
}

/** Read the last `maxBytes` of a file without loading the whole thing into memory. */
export async function tailFile(path: string, maxBytes: number): Promise<Tail> {
  let fh;
  try {
    fh = await open(path, "r");
  } catch {
    return { text: "", truncated: false, totalBytes: 0 };
  }
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buf = Buffer.alloc(length);
    if (length > 0) await fh.read(buf, 0, length, start);
    return { text: buf.toString("utf8"), truncated: start > 0, totalBytes: size };
  } finally {
    await fh.close();
  }
}
