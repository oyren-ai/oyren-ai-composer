import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Wrap a JSON-serialisable payload as an MCP tool result. */
export function jsonResult(data: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    isError,
  };
}
