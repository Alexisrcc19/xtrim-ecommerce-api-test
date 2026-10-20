import express from "express";
import cors from "cors";
import helmet from "helmet";
import type { PlansRepository } from "./modules/plans/plans.repository.js";
import { plansRouter } from "./modules/plans/plans.routes.js";
import { errorHandler } from "./middlewares/errors.js";
import { rateLimit } from "./middlewares/rate-limit.js";
import { adminAuth } from "./middlewares/auth.js";
import { LeadEvents } from "./modules/leads/leads.events.js";
import { leadsRouter } from "./modules/leads/leads.routes.js";
import type { LeadsService } from "./modules/leads/leads.service.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import type { DashboardRepository } from "./modules/dashboard/dashboard.repository.js";

interface CommercialModules {
  leads: LeadsService;
  dashboard: DashboardRepository;
  adminToken?: string;
}

export function createApp(plans: PlansRepository, commercial?: CommercialModules) {
  const app = express();
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) throw new Error("TRUST_PROXY_HOPS inválido");
  app.set("trust proxy", proxyHops);
  app.use(helmet());
  app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000" }));
  if (commercial) app.post("/api/v1/leads", rateLimit(10, 15 * 60000));
  app.use(express.json({ limit: "100kb" }));
  app.get("/api/v1/health", (_req, res) => {
    res.json({ status: "ok", service: "xtrim-ecommerce-api" });
  });
  app.use("/api/v1/plans", plansRouter(plans));
  if (commercial) {
    const authenticate = adminAuth(commercial.adminToken ?? process.env.ADMIN_API_TOKEN);
    const events = new LeadEvents();
    app.once("shutdown", () => events.close());
    app.use("/api/v1/leads", leadsRouter(commercial.leads, authenticate, events));
    app.use("/api/v1/dashboard", dashboardRouter(commercial.dashboard, authenticate));
  }
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Ruta no encontrada" } });
  });
  app.use(errorHandler);
  return app;
}
