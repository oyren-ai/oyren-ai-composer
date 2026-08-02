import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "../mcp/server.js";

/**
 * Stateless Streamable HTTP: a fresh server + transport per POST. Task identity
 * lives in the task UUID, not an MCP session, so no session bookkeeping is needed.
 */
export async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

/** GET/DELETE on /mcp are unused in stateless mode. */
export function handleMcpUnsupported(_req: Request, res: Response): void {
  res.status(405).json({ error: "method_not_allowed" });
}
