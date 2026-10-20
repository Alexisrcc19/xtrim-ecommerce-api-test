import type { Pool } from "pg";

export interface Metrics {
  total_leads: number;
  leads_by_status: { NEW: number; IN_PROGRESS: number; CLOSED: number };
  won_sales: number;
  monthly_sales_usd: string;
  currency: "USD";
}
export class DashboardRepository {
  constructor(private readonly db: Pick<Pool, "query">) {}

  async metrics(): Promise<Metrics> {
    const { rows } = await this.db.query<Metrics>(`
      SELECT count(*)::int AS total_leads,
        json_build_object('NEW', count(*) FILTER (WHERE status = 'NEW'),
          'IN_PROGRESS', count(*) FILTER (WHERE status = 'IN_PROGRESS'),
          'CLOSED', count(*) FILTER (WHERE status = 'CLOSED')) AS leads_by_status,
        count(*) FILTER (WHERE status = 'CLOSED' AND outcome = 'WON')::int AS won_sales,
        COALESCE(sum(sale_amount) FILTER (WHERE status = 'CLOSED' AND outcome = 'WON'), 0.00)::text AS monthly_sales_usd,
        'USD' AS currency FROM leads`);
    return rows[0]!;
  }
}
