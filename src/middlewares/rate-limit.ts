import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

// Local a cada proceso; acotado en memoria y sin temporizadores persistentes.
export function rateLimit(limit: number, windowMs: number): RequestHandler {
  const clients = new Map<string, { count: number; expires: number }>();
  let nextCleanup = 0;
  return (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const now = Date.now();
    if (now >= nextCleanup) {
      for (const [key, value] of clients) if (value.expires <= now) clients.delete(key);
      nextCleanup = now + 60000;
    }
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    let entry = clients.get(key);
    if (entry && entry.expires <= now) { clients.delete(key); entry = undefined; }
    if (!entry && clients.size < 10000) {
      entry = { count: 0, expires: now + windowMs };
      clients.set(key, entry);
    }
    if (!entry || entry.count >= limit) {
      res.set("Retry-After", String(Math.max(1, Math.ceil(((entry?.expires ?? now + windowMs) - now) / 1000))));
      throw new HttpError(429, "RATE_LIMITED", "Demasiadas solicitudes; intente más tarde");
    }
    entry.count++;
    next();
  };
}
