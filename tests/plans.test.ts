import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { PlansRepository } from "../src/modules/plans/plans.repository.js";
import { createPool } from "../src/config/database.js";

async function withApi(repository: PlansRepository, run: (base: string) => Promise<void>) {
  const server = createApp(repository).listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  try { await run(base); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("API: parametrización, validación, 404 y errores sin detalles internos", async () => {
  const queries: unknown[][] = [];
  const repository = new PlansRepository({
    query: (async (_sql: string, values: unknown[]) => {
      queries.push(values);
      if (values[0] === "fallo") throw new Error("secret connection details");
      return { rows: [] };
    }) as Pick<import("pg").Pool, "query">["query"],
  });
  await withApi(repository, async base => {
    const list = await fetch(`${base}/plans`);
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { data: [] });
    assert.deepEqual(queries[0], [true]);
    assert.equal((await fetch(`${base}/plans/no-existe`)).status, 404);
    assert.deepEqual(queries[1], ["no-existe", true]);
    assert.equal((await fetch(`${base}/plans/INVALIDO`)).status, 400);
    assert.equal(queries.length, 2);
    const failure = await fetch(`${base}/plans/fallo`);
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
    assert.equal((await fetch(`${base}/desconocido`)).status, 404);
  });
});

test("PostgreSQL: catálogo, detalle y restricciones de cierre/FK", { skip: process.env.DATABASE_TESTS !== "1" }, async () => {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(`INSERT INTO plans (name, slug, description, speed_mbps, monthly_price)
      VALUES ('Prueba', 'prueba-integracion', 'Temporal', 100, 12.34) RETURNING id`);
    const id = inserted.rows[0]!.id;
    await withApi(new PlansRepository(client), async base => {
      const list = await fetch(`${base}/plans`);
      assert.equal(list.status, 200);
      const body = await list.json() as { data: { id: string }[] };
      assert.ok(body.data.some(plan => plan.id === id));
      const detail = await fetch(`${base}/plans/prueba-integracion`);
      assert.equal(detail.status, 200);
      assert.equal(((await detail.json()) as { data: { monthly_price: string } }).data.monthly_price, "12.34");
      await client.query("UPDATE plans SET is_active = false WHERE id = $1", [id]);
      assert.equal((await fetch(`${base}/plans/prueba-integracion`)).status, 404);
    });
    const insert = (status: string, outcome: string | null, amount: string | null, planId = id) =>
      client.query(`INSERT INTO leads (full_name, phone, province, plan_id, status, outcome, sale_amount)
        VALUES ('Demo Test', '0991234567', 'Pichincha', $1, $2, $3, $4)`, [planId, status, outcome, amount]);
    await insert("NEW", null, null);
    await insert("IN_PROGRESS", null, null);
    await insert("CLOSED", "LOST", null);
    await insert("CLOSED", "WON", "12.34");
    for (const [status, outcome, amount] of [
      ["CLOSED", null, null], ["CLOSED", "WON", null], ["CLOSED", "LOST", "1"],
      ["NEW", "WON", "1"], ["OTHER", null, null], ["CLOSED", "WON", "-1"], ["CLOSED", "WON", "NaN"],
    ]) {
      await client.query("SAVEPOINT invalid_lead");
      await assert.rejects(insert(status!, outcome!, amount!), { code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT invalid_lead");
    }
    await client.query("SAVEPOINT invalid_fk");
    await assert.rejects(insert("NEW", null, null, "00000000-0000-0000-0000-000000000000"), { code: "23503" });
    await client.query("ROLLBACK TO SAVEPOINT invalid_fk");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
