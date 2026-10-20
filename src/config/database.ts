import "dotenv/config";
import pg from "pg";

export function createPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL es obligatoria");
  }
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", () => console.error("Error de conexión PostgreSQL"));
  return pool;
}
