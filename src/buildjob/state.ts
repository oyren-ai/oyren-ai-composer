import { join } from "node:path";
import { tailFile } from "../util/tail.js";
import { buildEnv } from "./env.js";

export type BuildState = "running" | "succeeded" | "failed";

/** Bytes of stdout/stderr tail returned by /status — bounded so a full image-build log
 *  (easily hundreds of MB) never lands in a poll response. */
const TAIL_BYTES = 64 * 1024;

const job = {
  state: "running" as BuildState,
  exitCode: null as number | null,
  startedAt: Date.now(),
  finishedAt: null as number | null,
};

export const stdoutPath = join(buildEnv.logsDir, "stdout.log");
export const stderrPath = join(buildEnv.logsDir, "stderr.log");

export function finish(state: Exclude<BuildState, "running">, exitCode: number | null): void {
  job.state = state;
  job.exitCode = exitCode;
  job.finishedAt = Date.now();
}

/** The /status payload: fixed-shape job record + bounded log tails read fresh per poll. */
export async function statusSnapshot(): Promise<object> {
  const [stdout, stderr] = await Promise.all([tailFile(stdoutPath, TAIL_BYTES), tailFile(stderrPath, TAIL_BYTES)]);
  return {
    state: job.state,
    exitCode: job.exitCode,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt === null ? null : new Date(job.finishedAt).toISOString(),
    stdoutTail: stdout.text,
    stdoutTruncated: stdout.truncated,
    stderrTail: stderr.text,
    stderrTruncated: stderr.truncated,
  };
}
