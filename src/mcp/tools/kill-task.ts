import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { killTask } from "../../runner/kill.js";
import { getTask } from "../../tasks/store.js";
import { jsonResult } from "../result.js";

export interface KillArgs {
  task_id: string;
}

export async function killTaskTool(args: KillArgs): Promise<CallToolResult> {
  const killed = await killTask(args.task_id, "killed");
  const t = getTask(args.task_id);
  return jsonResult({
    task_id: args.task_id,
    killed,
    state: t?.state ?? "unknown",
  });
}
