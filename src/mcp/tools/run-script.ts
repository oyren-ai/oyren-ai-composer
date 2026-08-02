import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Runtime } from "../../tasks/types.js";
import { createTask } from "../../tasks/lifecycle.js";
import { jsonResult } from "../result.js";

export interface RunScriptArgs {
  runtime: Runtime;
  command_base64: string;
  zip_base64?: string;
  timeout_seconds?: number;
  memory_mb?: number;
}

export async function runScript(args: RunScriptArgs): Promise<CallToolResult> {
  try {
    const taskId = await createTask({
      runtime: args.runtime,
      commandBase64: args.command_base64,
      zipBase64: args.zip_base64,
      timeoutSeconds: args.timeout_seconds,
      memoryMb: args.memory_mb,
    });
    return jsonResult({
      task_id: taskId,
      state: "queued",
      note: "Poll get_task_status with this task_id.",
    });
  } catch (err) {
    return jsonResult({ error: (err as Error).message }, true);
  }
}
