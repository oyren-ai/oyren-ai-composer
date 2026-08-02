import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runScriptShape, getStatusShape, killShape } from "./schemas.js";
import { runScript } from "./tools/run-script.js";
import { getStatus } from "./tools/get-status.js";
import { killTaskTool } from "./tools/kill-task.js";

/** Build a fresh MCP server instance with the three script-runner tools. */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "script-runner", version: "0.1.0" });

  server.registerTool(
    "run_script",
    {
      title: "Run script",
      description:
        "Launch a script in a disposable container (node24 / python3.8 / python3.13). " +
        "Returns a task_id immediately; the script runs asynchronously.",
      inputSchema: runScriptShape,
    },
    runScript,
  );

  server.registerTool(
    "get_task_status",
    {
      title: "Get task status",
      description:
        "Fetch a task's state, exit code, timing, and bounded stdout/stderr tails. " +
        "Use seconds_since_last_output to detect a stuck task.",
      inputSchema: getStatusShape,
    },
    getStatus,
  );

  server.registerTool(
    "kill_task",
    {
      title: "Kill task",
      description: "Stop a queued or running task.",
      inputSchema: killShape,
    },
    killTaskTool,
  );

  return server;
}
