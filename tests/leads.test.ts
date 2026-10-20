import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { createPool } from "../src/config/database.js";
import { PlansRepository } from "../src/modules/plans/plans.repository.js";
import { LeadsRepository } from "../src/modules/leads/leads.repository.js";
import { LeadsService } from "../src/modules/leads/leads.service.js";
import { DashboardRepository, type Metrics } from "../src/modules/dashboard/dashboard.repository.js";
import { createLeadInput, leadFilters, leadInput, statusInput, uuid } from "../src/modules/leads/leads.validation.js";
import { HttpError } from "../src/middlewares/errors.js";

const valid = { full_name: "Demo Comercial", phone: "0991234567", province: "Pichincha", plan_id: randomUUID() };
const token = randomBytes(32).toString("hex");
const validationError = (run: () => unknown) => assert.throws(run, (error: unknown) => error instanceof HttpError && error.status === 400);

test("Validación: campos públicos, normalización, filtros y reglas de cierre", () => {
  assert.deepEqual(createLeadInput({ ...valid, full_name: "  Demo   Comercial ", phone: "+593 99-123-4567", province: "  manabi " }),
    { ...valid, full_name: "Demo Comercial", phone: "+593991234567", province: "Manabí" });
  for (const body of [null, [], {}, { ...valid, full_name: "A" }, { ...valid, full_name: "123" },
    { ...valid, full_name: "Demo\nComercial" }, { ...valid, phone: "123" }, { ...valid, province: "Otra" },
    { ...valid, plan_id: "invalid" }, { ...valid, status: "CLOSED" }, { ...valid, outcome: "WON" },
    { ...valid, sale_amount: "1.00" }, { ...valid, phone: null }, { ...valid, plan_id: [valid.plan_id] }]) {
    validationError(() => createLeadInput(body));
  }
  validationError(() => leadInput({}, true));
  validationError(() => leadInput({ province: null }, true));
  validationError(() => uuid("not-a-uuid"));
  assert.deepEqual(statusInput({ status: "NEW" }), { status: "NEW", outcome: null, sale_amount: null });
  assert.deepEqual(statusInput({ status: "CLOSED", outcome: "LOST" }), { status: "CLOSED", outcome: "LOST", sale_amount: null });
  assert.equal(statusInput({ status: "CLOSED", outcome: "WON", sale_amount: "0.00" }).sale_amount, "0.00");
  for (const body of [{ status: "CLOSED" }, { status: "CLOSED", outcome: "WON" },
    { status: "CLOSED", outcome: "LOST", sale_amount: "0" }, { status: "NEW", outcome: "LOST" },
    { status: "OTHER" }, { status: "IN_PROGRESS", sale_amount: "1" }, { status: "NEW", extra: true }]) {
    validationError(() => statusInput(body));
  }
  for (const amount of [1, -1, "-1", "1.234", "NaN", "Infinity", "1e2", "100000000", "", null]) {
    validationError(() => statusInput({ status: "CLOSED", outcome: "WON", sale_amount: amount }));
  }
  assert.deepEqual(leadFilters({}), { page: 1, limit: 20 });
  assert.deepEqual(leadFilters({ province: "los rios", limit: "2", page: "3", status: "NEW", search: "Demo" }),
    { page: 3, limit: 2, status: "NEW", search: "Demo", province: "Los Ríos" });
  for (const query of [{ page: "0" }, { limit: "101" }, { page: "1.2" }, { search: ["a", "b"] },
    { status: "WON" }, { province: "Otra" }, { arbitrary: "x" }]) validationError(() => leadFilters(query));
});

async function withApi(db: Pick<Pool, "query">, adminToken: string, run: (base: string) => Promise<void>) {
  const app = createApp(new PlansRepository(db), {
    leads: new LeadsService(new LeadsRepository(db)), dashboard: new DashboardRepository(db), adminToken,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  try { await run(base); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const noDatabase: Pick<Pool, "query"> = { query: (() => { throw new Error("No debe consultar la BD"); }) as Pool["query"] };
const admin = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

test("Administración: todas las rutas requieren Bearer; configuración ausente falla cerrada", async () => {
  await withApi(noDatabase, token, async base => {
    for (const [method, path] of [["GET", "/leads"], ["GET", `/leads/${valid.plan_id}`],
      ["PATCH", `/leads/${valid.plan_id}`], ["PATCH", `/leads/${valid.plan_id}/status`],
      ["DELETE", `/leads/${valid.plan_id}`], ["GET", "/dashboard/metrics"]]) {
      for (const credential of [undefined, "Bearer wrong", "Basic invalid"]) {
        const response = await fetch(base + path, { method, headers: credential ? { Authorization: credential } : {} });
        assert.equal(response.status, 401);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("www-authenticate"), "Bearer");
      }
    }
    const invalid = await fetch(`${base}/leads/not-uuid`, { headers: admin });
    assert.equal(invalid.status, 400);
    const query = await fetch(`${base}/leads?limit=101`, { headers: admin });
    assert.equal(query.status, 400);
    assert.equal((await fetch(`${base}/plans`)).status, 500);
  });
  for (const configuration of ["", "short", " ".repeat(32)]) {
    await withApi(noDatabase, configuration, async base => {
      assert.equal((await fetch(`${base}/dashboard/metrics`, { headers: admin })).status, 503);
      assert.equal((await fetch(`${base}/leads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 400);
    });
  }
});

test("Captación: límite de solicitudes y errores HTTP de JSON/tamaño", async () => {
  await withApi(noDatabase, token, async base => {
    for (let i = 0; i < 10; i++) {
      const response = await fetch(`${base}/leads`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `192.0.2.${i}` }, body: "{}" });
      assert.equal(response.status, 400);
    }
    const limited = await fetch(`${base}/leads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  });
  await withApi(noDatabase, token, async base => {
    const invalid = await fetch(`${base}/leads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(invalid.status, 400);
    const huge = await fetch(`${base}/leads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: "x".repeat(110000) }) });
    assert.equal(huge.status, 413);
  });
});

const cents = (amount: string): bigint => {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
};

test("PostgreSQL HTTP: captación → CRUD → estados → métricas reales", { skip: process.env.DATABASE_TESTS !== "1" }, async () => {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const slug = `test-${randomUUID()}`;
    const { rows } = await client.query<{ id: string }>(`INSERT INTO plans(name, slug, description, speed_mbps, monthly_price)
      VALUES ('Demo', $1, 'Temporal', 100, 24.90) RETURNING id`, [slug]);
    const planId = rows[0]!.id;
    await withApi(client, token, async base => {
      const call = (path: string, method = "GET", body?: unknown, authenticated = true) => fetch(base + path, {
        method, headers: authenticated ? admin : { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const metrics = async () => {
        const response = await call("/dashboard/metrics");
        assert.equal(response.status, 200);
        return ((await response.json()) as { data: Metrics }).data;
      };
      const before = await metrics();
      const name = `Demo ${randomBytes(8).toString("hex").replace(/[0-9]/g, "a")}`;
      const payload = { ...valid, full_name: name, phone: `09${String(randomInt(100000000)).padStart(8, "0")}`, plan_id: planId };
      const created = await call("/leads", "POST", payload, false);
      assert.equal(created.status, 201);
      const { data: confirmation } = await created.json() as { data: { id: string; status: string; created_at: string } };
      assert.deepEqual(Object.keys(confirmation).sort(), ["created_at", "id", "status"]);
      assert.equal(confirmation.status, "NEW");
      const id = confirmation.id;
      const leadPath = `/leads/${id}`;
      const afterCreate = await metrics();
      assert.equal(afterCreate.total_leads, before.total_leads + 1);
      assert.equal(afterCreate.leads_by_status.NEW, before.leads_by_status.NEW + 1);
      assert.equal((await call("/leads", "POST", { ...payload, phone: "invalid" }, false)).status, 400);
      assert.equal((await call("/leads", "POST", { ...payload, plan_id: randomUUID() }, false)).status, 422);
      assert.equal((await metrics()).total_leads, afterCreate.total_leads);
      const list = await call(`/leads?search=${encodeURIComponent(name)}&status=NEW&province=pichincha&limit=1`);
      const listed = await list.json() as { data: { id: string }[]; pagination: { total: number } };
      assert.equal(listed.pagination.total, 1);
      assert.equal(listed.data[0]!.id, id);
      const emptyPage = await call(`/leads?search=${encodeURIComponent(name)}&page=2&limit=1`);
      const empty = await emptyPage.json() as { data: unknown[]; pagination: { total: number } };
      assert.deepEqual(empty.data, []);
      assert.equal(empty.pagination.total, 1);
      assert.equal((await call(`/leads?search=${encodeURIComponent("' OR 1=1 --")}`)).status, 200);
      assert.equal((await call(leadPath, "PATCH", { phone: "+593 " + payload.phone.slice(1), province: "guayas" })).status, 200);
      const detail = await (await call(leadPath)).json() as { data: { phone: string; province: string } };
      assert.equal(detail.data.phone, "+593" + payload.phone.slice(1));
      assert.equal(detail.data.province, "Guayas");
      assert.equal((await call(leadPath, "PATCH", { status: "CLOSED" })).status, 400);
      assert.equal((await call(leadPath, "PATCH", { plan_id: randomUUID() })).status, 422);
      assert.equal((await call(leadPath + "/status", "PATCH", { status: "IN_PROGRESS" })).status, 200);
      assert.equal((await metrics()).leads_by_status.IN_PROGRESS, before.leads_by_status.IN_PROGRESS + 1);
      for (const body of [{ status: "CLOSED" }, { status: "CLOSED", outcome: "WON" }, { status: "CLOSED", outcome: "LOST", sale_amount: "1.00" }]) {
        assert.equal((await call(leadPath + "/status", "PATCH", body)).status, 400);
      }
      assert.equal((await call(leadPath + "/status", "PATCH", { status: "CLOSED", outcome: "WON", sale_amount: "31.25" })).status, 200);
      const won = await metrics();
      assert.equal(won.won_sales, before.won_sales + 1);
      assert.equal(won.leads_by_status.CLOSED, before.leads_by_status.CLOSED + 1);
      assert.equal(cents(won.monthly_sales_usd), cents(before.monthly_sales_usd) + 3125n);
      const wonListResponse = await call(`/leads?search=${encodeURIComponent(name)}`);
      const wonList = await wonListResponse.json() as { data: { sale_amount: string | null }[] };
      assert.equal(wonList.data[0]!.sale_amount, "31.25");
      const secondResponse = await call("/leads", "POST", { ...payload, phone: `09${String(randomInt(100000000)).padStart(8, "0")}`, full_name: name + " Segundo" }, false);
      assert.equal(secondResponse.status, 201);
      const second = await secondResponse.json() as { data: { id: string } };
      const secondPath = `/leads/${second.data.id}`;
      assert.equal((await call(secondPath + "/status", "PATCH", { status: "CLOSED", outcome: "WON", sale_amount: "0.10" })).status, 409);
      assert.equal((await call(secondPath + "/status", "PATCH", { status: "IN_PROGRESS" })).status, 200);
      assert.equal((await call(secondPath + "/status", "PATCH", { status: "CLOSED", outcome: "WON", sale_amount: "0.10" })).status, 200);
      const twoWon = await metrics();
      assert.equal(twoWon.won_sales, before.won_sales + 2);
      assert.equal(cents(twoWon.monthly_sales_usd), cents(before.monthly_sales_usd) + 3135n);
      assert.equal((await call(secondPath + "/status", "PATCH", { status: "CLOSED", outcome: "LOST" })).status, 409);
      const withLost = await metrics();
      assert.equal(withLost.won_sales, before.won_sales + 2);
      assert.equal(withLost.monthly_sales_usd, twoWon.monthly_sales_usd);
      assert.equal((await call(secondPath, "DELETE")).status, 204);
      await client.query("UPDATE plans SET monthly_price = 99, is_active = false WHERE id = $1", [planId]);
      assert.equal((await metrics()).monthly_sales_usd, won.monthly_sales_usd);
      assert.equal((await call("/leads", "POST", payload, false)).status, 422);
      assert.equal((await call(leadPath, "PATCH", { plan_id: planId })).status, 422);
      assert.equal((await call(leadPath + "/status", "PATCH", { status: "CLOSED", outcome: "LOST" })).status, 409);
      assert.equal((await call(leadPath + "/status", "PATCH", { status: "NEW" })).status, 409);
      assert.deepEqual(await metrics(), won);
      assert.equal((await call(leadPath, "DELETE")).status, 204);
      assert.equal((await call(leadPath)).status, 404);
      assert.equal((await call(leadPath, "DELETE")).status, 404);
      assert.equal((await call(leadPath, "PATCH", { province: "Azuay" })).status, 404);
      assert.equal((await call(leadPath + "/status", "PATCH", { status: "NEW" })).status, 404);
      assert.deepEqual(await metrics(), before);
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
