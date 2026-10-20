import type { ErrorRequestHandler } from "express";

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (
    typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === "leads_active_phone_unique"
  ) {
    res.status(409).json({ error: {
      code: "ACTIVE_PHONE_EXISTS",
      message: "Ya existe una solicitud en Nuevo o En gestión con este teléfono",
    } });
    return;
  }
  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "JSON inválido" } });
    return;
  }
  if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
    res.status(413).json({ error: { code: "BODY_TOO_LARGE", message: "Solicitud demasiado grande" } });
    return;
  }
  console.error("Error interno al procesar la solicitud");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
};
