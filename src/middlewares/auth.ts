import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

export function adminAuth(token: string | undefined): RequestHandler {
  const configured = token !== undefined && token.length >= 32 && token.length <= 512 && !/\s/.test(token);
  const digest = configured ? createHash("sha256").update(token).digest() : undefined;
  return (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!digest) throw new HttpError(503, "ADMIN_UNAVAILABLE", "Acceso administrativo no configurado");
    const match = /^Bearer ([^\s]{1,512})$/i.exec(req.get("authorization") ?? "");
    if (!match || !timingSafeEqual(digest, createHash("sha256").update(match[1]!).digest())) {
      res.set("WWW-Authenticate", "Bearer");
      throw new HttpError(401, "UNAUTHORIZED", "Autenticación requerida");
    }
    next();
  };
}
