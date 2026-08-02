import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Bearer-auth middleware over a caller-supplied token (src/http/auth.ts is bound to the MCP
 *  lane's config; the VM lanes each carry their own token). */
export function bearerAuth(token: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (presented && safeEqual(presented, token)) {
      next();
      return;
    }
    res.setHeader("WWW-Authenticate", "Bearer");
    res.status(401).json({ error: "unauthorized" });
  };
}
