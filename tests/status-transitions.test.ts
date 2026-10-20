import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { createPool } from "../src/config/database.js";
import { PlansRepository } from "../src/modules/plans/plans.repository.js";
import { LeadsRepository, type Lead } from "../src/modules/leads/leads.repository.js";
import { LeadsService } from "../src/modules/leads/leads.service.js";
import { DashboardRepository } from "../src/modules/dashboard/dashboard.repository.js";
import type { LeadStatus } from "../src/modules/leads/leads.validation.js";

async function withApi(db: Pick<Pool, "query">, run: (base: string, headers: Record<string, string>) => Promise<void>) {
  const token = randomBytes(32).toString("hex");
  const app = createApp(new PlansRepository(db), {
    leads: new LeadsService(new LeadsRepository(db)), dashboard: new DashboardRepository(db), adminToken: token,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/leads`, {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    });
  } finally {
    app.emit("shutdown");
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
const statuses: LeadStatus[] = ["NEW", "IN_PROGRESS", "CLOSED"];

async function matrix(db: Pick<Pool, "query">, fixture: (status: LeadStatus, outcome: "WON" | "LOST") => Promise<Lead>) {
  await withApi(db, async (base, headers) => {
    for (const current of statuses) for (const outcome of ["WON", "LOST"] as const) for (const next of statuses) {
      const original = await fixture(current, outcome);
      const input = next === "CLOSED" ? { status: next, outcome, ...(outcome === "WON" ? { sale_amount: "25.50" } : {}) } : { status: next };
      const allowed = current === "NEW" && next === "IN_PROGRESS" || current === "IN_PROGRESS" && next === "CLOSED";
      const response = await fetch(`${base}/${original.id}/status`, { method: "PATCH", headers, body: JSON.stringify(input) });
      assert.equal(response.status, allowed ? 200 : 409, `${current} → ${next} (${outcome})`);
      if (!allowed) {
        const error = await response.json() as { error: { code: string } };
        assert.equal(error.error.code, "INVALID_STATUS_TRANSITION");
      }
      const persisted = (await (await fetch(`${base}/${original.id}`, { headers })).json() as { data: Lead }).data;
      assert.equal(persisted.status, allowed ? next : original.status);
      assert.equal(persisted.outcome, allowed ? next === "CLOSED" ? outcome : null : original.outcome);
      assert.equal(persisted.sale_amount, allowed ? next === "CLOSED" && outcome === "WON" ? "25.50" : null : original.sale_amount);
    }
    const missing = await fetch(`${base}/${randomUUID()}/status`, { method: "PATCH", headers, body: JSON.stringify({ status: "IN_PROGRESS" }) });
    assert.equal(missing.status, 404);
  });
}

test("HTTP directo: todas las transiciones, repeticiones y cierres terminales WON/LOST", async () => {
  const rows = new Map<string, Lead>();
  const db = { query: (async (sql: string, values: unknown[]) => {
    const lead = rows.get(String(values[0]));
    if (!lead) return { rows: [] };
    if (sql.trim().startsWith("SELECT")) return { rows: [{ ...lead }] };
    assert.match(sql, /AND status = \$5/);
    if (lead.status !== values[4]) return { rows: [] };
    const updated = { ...lead, status: values[1], outcome: values[2], sale_amount: values[3] } as Lead;
    rows.set(updated.id, updated);
    return { rows: [updated] };
  }) as Pool["query"] };
  await matrix(db, async (status, outcome) => {
    const lead: Lead = { id: randomUUID(), full_name: "Demo Flujo", phone: "0991234567", province: "Pichincha", plan_id: randomUUID(), status,
      outcome: status === "CLOSED" ? outcome : null, sale_amount: status === "CLOSED" && outcome === "WON" ? "10.00" : null,
      created_at: new Date(), updated_at: new Date() };
    rows.set(lead.id, lead);
    return lead;
  });
});

test("escritura obsoleta devuelve 409 en lugar de sobrescribir otro cambio", async () => {
  const id = randomUUID();
  const db = { query: (async (sql: string) => ({ rows: sql.trim().startsWith("SELECT") ? [{ id, status: "NEW" }] : [] })) as Pool["query"] };
  await withApi(db, async (base, headers) => {
    const response = await fetch(`${base}/${id}/status`, { method: "PATCH", headers, body: JSON.stringify({ status: "IN_PROGRESS" }) });
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "INVALID_STATUS_TRANSITION");
  });
});

test("PostgreSQL HTTP: matriz de transiciones conserva cierres y montos rechazados", { skip: process.env.DATABASE_TESTS !== "1" }, async () => {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const plan = await client.query<{ id: string }>(`INSERT INTO plans(name,slug,description,speed_mbps,monthly_price)
      VALUES ('Demo Flujo',$1,'Temporal',100,10) RETURNING id`, [`test-flow-${randomUUID()}`]);
    await matrix(client, async (status, outcome) => {
      const result = await client.query<Lead>(`INSERT INTO leads(full_name,phone,province,plan_id,status,outcome,sale_amount)
        VALUES ('Demo Flujo',$1,'Pichincha',$2,$3,$4,$5) RETURNING *`, [
        `09${String(randomInt(100000000)).padStart(8, "0")}`, plan.rows[0]!.id, status,
        status === "CLOSED" ? outcome : null, status === "CLOSED" && outcome === "WON" ? "10.00" : null,
      ]);
      return result.rows[0]!;
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
