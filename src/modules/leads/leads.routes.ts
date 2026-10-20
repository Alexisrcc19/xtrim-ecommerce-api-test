import { Router, type RequestHandler } from "express";
import type { LeadEvents } from "./leads.events.js";
import type { LeadsService } from "./leads.service.js";

export function leadsRouter(service: LeadsService, authenticate: RequestHandler, events: LeadEvents): Router {
  const router = Router();
  router.post("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const data = await service.create(req.body);
    events.publish();
    res.status(201).json({ data });
  });
  router.use(authenticate);
  router.get("/", async (req, res) => { res.json(await service.list(req.query)); });
  router.get("/events", (req, res) => { events.subscribe(req, res); });
  router.get("/:id", async (req, res) => { res.json({ data: await service.detail(req.params.id) }); });
  router.patch("/:id", async (req, res) => { const data = await service.edit(req.params.id, req.body); events.publish(); res.json({ data }); });
  router.patch("/:id/status", async (req, res) => { const data = await service.changeStatus(req.params.id, req.body); events.publish(); res.json({ data }); });
  router.delete("/:id", async (req, res) => { await service.delete(req.params.id); events.publish(); res.sendStatus(204); });
  return router;
}
