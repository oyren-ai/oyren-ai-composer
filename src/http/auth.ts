import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Reject requests lacking a valid `Authorization: Bearer <token>` header. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token && safeEqual(token, config.token)) {
    next();
    return;
  }
  res.setHeader("WWW-Authenticate", "Bearer");
  res.status(401).json({ error: "unauthorized" });
}
