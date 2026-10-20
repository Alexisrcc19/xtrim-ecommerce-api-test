import express from "express";
import cors from "cors";
import helmet from "helmet";
import type { PlansRepository } from "./modules/plans/plans.repository.js";
import { plansRouter } from "./modules/plans/plans.routes.js";
import { errorHandler } from "./middlewares/errors.js";

export function createApp(plans: PlansRepository) {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000" }));
  app.use(express.json({ limit: "100kb" }));
  app.get("/api/v1/health", (_req, res) => {
    res.json({ status: "ok", service: "xtrim-ecommerce-api" });
  });
  app.use("/api/v1/plans", plansRouter(plans));
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Ruta no encontrada" } });
  });
  app.use(errorHandler);
  return app;
}
