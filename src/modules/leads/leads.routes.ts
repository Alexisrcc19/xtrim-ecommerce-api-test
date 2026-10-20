import { Router, type RequestHandler } from "express";
import type { LeadsService } from "./leads.service.js";

export function leadsRouter(service: LeadsService, authenticate: RequestHandler): Router {
  const router = Router();
  router.post("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.status(201).json({ data: await service.create(req.body) });
  });
  router.use(authenticate);
  router.get("/", async (req, res) => { res.json(await service.list(req.query)); });
  router.get("/:id", async (req, res) => { res.json({ data: await service.detail(req.params.id) }); });
  router.patch("/:id", async (req, res) => { res.json({ data: await service.edit(req.params.id, req.body) }); });
  router.patch("/:id/status", async (req, res) => { res.json({ data: await service.changeStatus(req.params.id, req.body) }); });
  router.delete("/:id", async (req, res) => { await service.delete(req.params.id); res.sendStatus(204); });
  return router;
}
