import type { Pool } from "pg";

export interface Plan {
  id: string;
  name: string;
  slug: string;
  description: string;
  speed_mbps: number;
  monthly_price: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const columns = "id, name, slug, description, speed_mbps, monthly_price, is_active, created_at, updated_at";

export class PlansRepository {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async list(): Promise<Plan[]> {
    const result = await this.pool.query<Plan>(
      `SELECT ${columns} FROM plans WHERE is_active = $1 ORDER BY monthly_price, slug`, [true],
    );
    return result.rows;
  }

  async findBySlug(slug: string): Promise<Plan | undefined> {
    const result = await this.pool.query<Plan>(
      `SELECT ${columns} FROM plans WHERE slug = $1 AND is_active = $2`, [slug, true],
    );
    return result.rows[0];
  }
}
