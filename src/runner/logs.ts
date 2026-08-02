import { createWriteStream } from "node:fs";
import { Writable } from "node:stream";
import type Docker from "dockerode";
import { stdoutPath, stderrPath } from "../workspace/paths.js";

/** A Writable that appends to `path` and pings `onOutput` on every chunk. */
function sink(path: string, onOutput: () => void): Writable {
  const file = createWriteStream(path, { flags: "a" });
  return new Writable({
    write(chunk, _enc, cb) {
      onOutput();
      file.write(chunk, cb);
    },
    final(cb) {
      file.end(cb);
    },
  });
}

/**
 * Attach to the container and demux its stdout/stderr into per-task log files.
 * Returns a promise that resolves when the output stream ends.
 */
export async function captureLogs(
  container: Docker.Container,
  id: string,
  onOutput: () => void,
): Promise<void> {
  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  });
  const out = sink(stdoutPath(id), onOutput);
  const err = sink(stderrPath(id), onOutput);
  container.modem.demuxStream(stream, out, err);
  await new Promise<void>((res) => {
    stream.on("end", res);
    stream.on("close", res);
  });
  out.end();
  err.end();
}
