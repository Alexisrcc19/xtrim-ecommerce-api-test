import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { createPool } from "../src/config/database.js";
import { PlansRepository } from "../src/modules/plans/plans.repository.js";
import { LeadsRepository } from "../src/modules/leads/leads.repository.js";
import { LeadsService } from "../src/modules/leads/leads.service.js";
import { DashboardRepository } from "../src/modules/dashboard/dashboard.repository.js";

const token = randomBytes(32).toString("hex");
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const phone = () => `09${String(randomInt(100000000)).padStart(8, "0")}`;
async function serve(db: Pick<Pool, "query">) {
  const app = createApp(new PlansRepository(db), { leads: new LeadsService(new LeadsRepository(db)), dashboard: new DashboardRepository(db), adminToken: token });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/leads`,
    close: async () => { app.emit("shutdown"); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}

test("conflicto de teléfono devuelve 409 controlado para creación y edición", async () => {
  const id = randomUUID();
  const db = { query: (async (sql: string) => {
    if (sql.trim().startsWith("SELECT")) return { rows: [{ id }] };
    throw { code: "23505", constraint: "leads_active_phone_unique", detail: "private telephone and SQL" };
  }) as Pool["query"] };
  const api = await serve(db);
  try {
    for (const [method, path, body] of [
      ["POST", "", { full_name: "Demo Unicidad", phone: phone(), province: "Pichincha", plan_id: randomUUID() }],
      ["PATCH", `/${id}`, { phone: phone() }],
    ] as const) {
      const response = await fetch(api.base + path, { method, headers, body: JSON.stringify(body) });
      assert.equal(response.status, 409);
      const result = await response.json() as { error: { code: string; message: string } };
      assert.equal(result.error.code, "ACTIVE_PHONE_EXISTS");
      assert.ok(!JSON.stringify(result).includes("private"));
    }
  } finally { await api.close(); }
});

test("PostgreSQL: unicidad activa atómica, formatos equivalentes y nueva solicitud tras cierre", { skip: process.env.DATABASE_TESTS !== "1" }, async () => {
  const pool = createPool();
  let planId: string | undefined;
  let api: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    const plans = await pool.query<{ id: string }>(`INSERT INTO plans(name,slug,description,speed_mbps,monthly_price) VALUES ('Demo Unicidad',$1,'Temporal',100,10) RETURNING id`, [`test-unique-${randomUUID()}`]);
    planId = plans.rows[0]!.id;
    api = await serve(pool);
    const input = { full_name: "Demo Unicidad", phone: phone(), province: "Pichincha", plan_id: planId };
    const call = (path: string, method: string, body?: unknown) => fetch(api!.base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const attempts = await Promise.all([
      call("", "POST", input),
      call("", "POST", { ...input, phone: "+593" + input.phone.slice(1) }),
    ]);
    assert.deepEqual(attempts.map(r => r.status).sort(), [201, 409]);
    const winner = attempts.find(r => r.status === 201)!;
    const first = ((await winner.json()) as { data: { id: string } }).data.id;
    const conflict = attempts.find(r => r.status === 409)!;
    assert.equal(((await conflict.json()) as { error: { code: string } }).error.code, "ACTIVE_PHONE_EXISTS");
    assert.equal((await call(`/${first}/status`, "PATCH", { status: "IN_PROGRESS" })).status, 200);
    assert.equal((await call("", "POST", input)).status, 409);
    assert.equal((await call(`/${first}/status`, "PATCH", { status: "CLOSED", outcome: "LOST" })).status, 200);
    const next = await call("", "POST", input);
    assert.equal(next.status, 201);
    const second = ((await next.json()) as { data: { id: string } }).data.id;
    assert.equal((await call(`/${first}/status`, "PATCH", { status: "NEW" })).status, 409);
    const unchanged = (await (await call(`/${first}`, "GET")).json()) as { data: { status: string; outcome: string } };
    assert.equal(unchanged.data.status, "CLOSED");
    assert.equal(unchanged.data.outcome, "LOST");
    const distinct = await call("", "POST", { ...input, phone: phone() });
    assert.equal(distinct.status, 201);
    const third = ((await distinct.json()) as { data: { id: string } }).data.id;
    assert.equal((await call(`/${third}`, "PATCH", { phone: "+593" + input.phone.slice(1) })).status, 409);
    // A record can retain its own phone when editing other fields.
    assert.equal((await call(`/${second}`, "PATCH", { phone: input.phone, province: "Guayas" })).status, 200);
    assert.equal((await call(`/${second}/status`, "PATCH", { status: "IN_PROGRESS" })).status, 200);
    assert.equal((await call(`/${second}/status`, "PATCH", { status: "CLOSED", outcome: "WON", sale_amount: "10.00" })).status, 200);
    assert.equal((await call(`/${first}/status`, "PATCH", { status: "NEW" })).status, 409);
    assert.equal((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM leads WHERE plan_id=$1", [planId])).rows[0]!.count, 3);
  } finally {
    await api?.close();
    if (planId) {
      // Only fixtures owned by this test; never modify pre-existing records.
      await pool.query("DELETE FROM leads WHERE plan_id=$1", [planId]);
      await pool.query("DELETE FROM plans WHERE id=$1", [planId]);
    }
    await pool.end();
  }
});
