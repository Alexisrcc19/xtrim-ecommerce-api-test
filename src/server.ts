import "dotenv/config";
import { createApp } from "./app.js";
import { createPool } from "./config/database.js";
import { PlansRepository } from "./modules/plans/plans.repository.js";
import { LeadsRepository } from "./modules/leads/leads.repository.js";
import { LeadsService } from "./modules/leads/leads.service.js";
import { DashboardRepository } from "./modules/dashboard/dashboard.repository.js";

async function start(): Promise<void> {
  const pool = createPool();
  try {
    await pool.query("SELECT 1");
  } catch {
    await pool.end();
    throw new Error("No se pudo conectar a PostgreSQL");
  }
  const port = Number(process.env.PORT ?? 4000);
  const server = createApp(new PlansRepository(pool), {
    leads: new LeadsService(new LeadsRepository(pool)),
    dashboard: new DashboardRepository(pool),
  }).listen(port, () => {
    console.log(`API running on http://localhost:${port}`);
  });
  const shutdown = () => {
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(() => {
      void pool.end().then(() => { clearTimeout(timeout); });
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.on("error", () => {
    console.error("No se pudo iniciar el servidor HTTP");
    void pool.end();
    process.exitCode = 1;
  });
}

void start().catch(() => {
  console.error("No se pudo iniciar la API; revise la configuración y PostgreSQL");
  process.exitCode = 1;
});
