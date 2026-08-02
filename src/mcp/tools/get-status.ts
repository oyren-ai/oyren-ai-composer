import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getTask } from "../../tasks/store.js";
import { stdoutPath, stderrPath } from "../../workspace/paths.js";
import { tailFile } from "../../util/tail.js";
import { jsonResult } from "../result.js";

export interface GetStatusArgs {
  task_id: string;
  tail_bytes?: number;
}

export async function getStatus(args: GetStatusArgs): Promise<CallToolResult> {
  const t = getTask(args.task_id);
  if (!t) return jsonResult({ error: "task_not_found", task_id: args.task_id }, true);

  const n = args.tail_bytes ?? 2000;
  const [out, err] = await Promise.all([
    tailFile(stdoutPath(t.id), n),
    tailFile(stderrPath(t.id), n),
  ]);
  const now = Date.now();

  return jsonResult({
    task_id: t.id,
    runtime: t.runtime,
    memory_mb: t.memoryMb,
    state: t.state,
    exit_code: t.exitCode,
    reason: t.reason,
    created_at: t.createdAt,
    started_at: t.startedAt,
    finished_at: t.finishedAt,
    runtime_seconds: t.startedAt ? Math.round(((t.finishedAt ?? now) - t.startedAt) / 1000) : 0,
    seconds_since_last_output: t.lastOutputAt ? Math.round((now - t.lastOutputAt) / 1000) : null,
    stdout_tail: out.text,
    stdout_truncated: out.truncated,
    stderr_tail: err.text,
    stderr_truncated: err.truncated,
  });
}
