import { Router } from "express";
import { HttpError } from "../../middlewares/errors.js";
import type { PlansRepository } from "./plans.repository.js";

export function plansRouter(repository: PlansRepository): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    res.json({ data: await repository.list() });
  });
  router.get("/:slug", async (req, res) => {
    const slug = req.params.slug;
    if (slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new HttpError(400, "INVALID_SLUG", "Slug inválido");
    }
    const plan = await repository.findBySlug(slug);
    if (!plan) throw new HttpError(404, "PLAN_NOT_FOUND", "Plan no encontrado");
    res.json({ data: plan });
  });
  return router;
}
