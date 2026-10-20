import { Router, type RequestHandler } from "express";
import type { DashboardRepository } from "./dashboard.repository.js";

export function dashboardRouter(repository: DashboardRepository, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate);
  router.get("/metrics", async (_req, res) => { res.json({ data: await repository.metrics() }); });
  return router;
}
