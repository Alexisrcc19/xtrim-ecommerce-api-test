import type { Pool } from "pg";
import type { LeadFilters, LeadInput, LeadStatus, StatusInput } from "./leads.validation.js";

export interface Lead extends LeadInput {
  id: string; status: LeadStatus; outcome: "WON" | "LOST" | null; sale_amount: string | null;
  created_at: Date; updated_at: Date;
}
// El cast conserva decimales como cadenas también dentro de json_agg.
const columns = "id, full_name, phone, province, plan_id, status, outcome, sale_amount::text AS sale_amount, created_at, updated_at";

export class LeadsRepository {
  constructor(private readonly db: Pick<Pool, "query">) {}

  async create(input: LeadInput): Promise<Lead | undefined> {
    const { rows } = await this.db.query<Lead>(`
      WITH selected_plan AS (SELECT id FROM plans WHERE id = $4 AND is_active = true FOR SHARE)
      INSERT INTO leads (full_name, phone, province, plan_id)
      SELECT $1, $2, $3, id FROM selected_plan RETURNING ${columns}`,
      [input.full_name, input.phone, input.province, input.plan_id]);
    return rows[0];
  }

  async list(filters: LeadFilters): Promise<{ data: Lead[]; total: number }> {
    // Un solo snapshot conserva total y página coherentes, incluso para páginas vacías.
    const { rows } = await this.db.query<{ data: Lead[]; total: number }>(`
      WITH filtered AS (
        SELECT ${columns} FROM leads
        WHERE ($1::text IS NULL OR strpos(lower(full_name), lower($1)) > 0 OR strpos(phone, $1) > 0)
          AND ($2::text IS NULL OR status = $2) AND ($3::text IS NULL OR province = $3)
      ), page AS (SELECT * FROM filtered ORDER BY created_at DESC, id DESC LIMIT $4 OFFSET $5)
      SELECT COALESCE((SELECT json_agg(page ORDER BY created_at DESC, id DESC) FROM page), '[]'::json) AS data,
        (SELECT count(*)::int FROM filtered) AS total`,
      [filters.search ?? null, filters.status ?? null, filters.province ?? null, filters.limit, (filters.page - 1) * filters.limit]);
    return rows[0]!;
  }

  async find(id: string): Promise<Lead | undefined> {
    return (await this.db.query<Lead>(`SELECT ${columns} FROM leads WHERE id = $1`, [id])).rows[0];
  }

  async edit(id: string, input: Partial<LeadInput>): Promise<Lead | undefined> {
    const { rows } = await this.db.query<Lead>(`
      WITH selected_plan AS (SELECT id FROM plans WHERE id = $5 AND is_active = true FOR SHARE)
      UPDATE leads SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone),
        province = COALESCE($4, province), plan_id = COALESCE($5::uuid, plan_id)
      WHERE id = $1 AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM selected_plan)) RETURNING ${columns}`,
      [id, input.full_name ?? null, input.phone ?? null, input.province ?? null, input.plan_id ?? null]);
    return rows[0];
  }

  async changeStatus(id: string, input: StatusInput, currentStatus: LeadStatus): Promise<Lead | undefined> {
    return (await this.db.query<Lead>(`
      UPDATE leads SET status = $2, outcome = $3, sale_amount = $4 WHERE id = $1 AND status = $5 RETURNING ${columns}`,
      [id, input.status, input.outcome, input.sale_amount, currentStatus])).rows[0];
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.query("DELETE FROM leads WHERE id = $1", [id])).rowCount === 1;
  }
}
