import { HttpError } from "../../middlewares/errors.js";
import type { LeadsRepository } from "./leads.repository.js";
import { createLeadInput, leadFilters, leadInput, statusInput, uuid } from "./leads.validation.js";

export class LeadsService {
  constructor(private readonly repository: LeadsRepository) {}

  async create(body: unknown) {
    const lead = await this.repository.create(createLeadInput(body));
    if (!lead) throw new HttpError(422, "PLAN_UNAVAILABLE", "El plan no existe o no está activo");
    return { id: lead.id, status: lead.status, created_at: lead.created_at };
  }

  async list(query: unknown) {
    const filters = leadFilters(query);
    const result = await this.repository.list(filters);
    return { data: result.data, pagination: { page: filters.page, limit: filters.limit, total: result.total, total_pages: Math.ceil(result.total / filters.limit) } };
  }

  async detail(id: string) {
    const lead = await this.repository.find(uuid(id));
    if (!lead) throw new HttpError(404, "LEAD_NOT_FOUND", "Lead no encontrado");
    return lead;
  }

  async edit(id: string, body: unknown) {
    const input = leadInput(body, true);
    await this.detail(id);
    const lead = await this.repository.edit(id, input);
    if (!lead) {
      await this.detail(id);
      throw new HttpError(422, "PLAN_UNAVAILABLE", "El plan no existe o no está activo");
    }
    return lead;
  }

  async changeStatus(id: string, body: unknown) {
    const input = statusInput(body);
    const lead = await this.repository.changeStatus(uuid(id), input);
    if (!lead) throw new HttpError(404, "LEAD_NOT_FOUND", "Lead no encontrado");
    return lead;
  }

  async delete(id: string) {
    if (!await this.repository.delete(uuid(id))) throw new HttpError(404, "LEAD_NOT_FOUND", "Lead no encontrado");
  }
}
