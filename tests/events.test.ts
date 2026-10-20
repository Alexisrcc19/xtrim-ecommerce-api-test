import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { PlansRepository } from "../src/modules/plans/plans.repository.js";
import { LeadsRepository } from "../src/modules/leads/leads.repository.js";
import { LeadsService } from "../src/modules/leads/leads.service.js";
import { DashboardRepository } from "../src/modules/dashboard/dashboard.repository.js";

// HTTP integration with a repository fixture; no database or personal data.
test("SSE protegido: ready, avisos tras mutaciones exitosas, sin PII y cierre limpio", async () => {
  const token = randomBytes(32).toString("hex");
  const lead = { id: randomUUID(), full_name: "Demo Eventos", phone: "0991234567", province: "Pichincha", plan_id: randomUUID(), status: "NEW", outcome: null, sale_amount: null, created_at: new Date(), updated_at: new Date() };
  const db = { query: (async () => ({ rows: [lead], rowCount: 1 })) as Pool["query"] };
  const app = createApp(new PlansRepository(db), { leads: new LeadsService(new LeadsRepository(db)), dashboard: new DashboardRepository(db), adminToken: token });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/leads`;
  const abort = new AbortController();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  try {
    for (const credential of [undefined, "Bearer incorrect"]) {
      const response = await fetch(base + "/events", { headers: credential ? { Authorization: credential } : {} });
      assert.equal(response.status, 401);
    }
    const response = await fetch(base + "/events", { headers, signal: abort.signal });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-type")?.startsWith("text/event-stream"));
    assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    async function frame() {
      while (!buffer.includes("\n\n")) {
        const { done, value } = await reader.read();
        assert.equal(done, false);
        buffer += decoder.decode(value, { stream: true });
      }
      const end = buffer.indexOf("\n\n");
      const value = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      return value;
    }
    const ready = await frame();
    assert.match(ready, /event: ready/);
    assert.match(ready, /data: [a-f0-9-]+:0/);
    assert.equal((await fetch(base, { method: "POST", headers, body: "{}" })).status, 400);
    const input = { full_name: lead.full_name, phone: lead.phone, province: lead.province, plan_id: lead.plan_id };
    const mutations = [
      ["POST", "", input, 201],
      ["PATCH", `/${lead.id}`, { province: "Guayas" }, 200],
      ["PATCH", `/${lead.id}/status`, { status: "IN_PROGRESS" }, 200],
      ["DELETE", `/${lead.id}`, undefined, 204],
    ] as const;
    for (const [index, [method, path, body, status]] of mutations.entries()) {
      const changed = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(changed.status, status);
      await changed.arrayBuffer();
      const event = await frame();
      assert.match(event, /event: leads-changed/);
      assert.match(event, new RegExp(`data: [a-f0-9-]+:${index + 1}$`));
      for (const secret of [lead.full_name, lead.phone, lead.id, lead.plan_id, token]) assert.ok(!event.includes(secret));
    }
    app.emit("shutdown");
    assert.equal((await reader.read()).done, true);
    await reader.cancel();
  } finally {
    abort.abort();
    app.emit("shutdown");
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
