import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createPool } from "../config/database.js";

async function run(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "migrate" && mode !== "seed") throw new Error("Modo inválido");
  const pool = createPool();
  const client = await pool.connect().catch(async () => {
    await pool.end();
    throw new Error("Conexión fallida");
  });
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [68743521]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const directory = fileURLToPath(new URL("../../database/migrations/", import.meta.url));
    const files = (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    for (const name of files) {
      const sql = await readFile(`${directory}/${name}`, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const applied = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name = $1", [name],
      );
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum) throw new Error("Migración aplicada modificada");
        continue;
      }
      if (mode === "seed") throw new Error("Ejecute db:migrate antes de db:seed");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
      console.log(`Migración: ${name}`);
    }
    if (mode === "seed") {
      const sql = await readFile(new URL("../../database/seeds/plans.sql", import.meta.url), "utf8");
      await client.query(sql);
    }
    await client.query("COMMIT");
    console.log(mode === "seed" ? "Planes de demostración cargados" : "Migraciones verificadas");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void run().catch(() => {
  console.error("Operación fallida; revise conexión, migraciones pendientes y esquema. No se aplicaron cambios de esta ejecución.");
  process.exitCode = 1;
});
