import express, { type Express } from "express";
import { config } from "../config.js";
import { requireAuth } from "./auth.js";
import { handleMcpPost, handleMcpUnsupported } from "./mcp-handler.js";

export function createApp(): Express {
  const app = express();

  // Base64 zips inflate ~37%; allow headroom over the raw zip cap.
  const limitMb = Math.ceil((config.maxZipBytes * 1.4) / 1024 / 1024) + 5;
  app.use(express.json({ limit: `${limitMb}mb` }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/mcp", requireAuth, (req, res) => {
    handleMcpPost(req, res).catch(() => {
      if (!res.headersSent) res.status(500).json({ error: "internal_error" });
    });
  });
  app.get("/mcp", requireAuth, handleMcpUnsupported);
  app.delete("/mcp", requireAuth, handleMcpUnsupported);

  return app;
}
