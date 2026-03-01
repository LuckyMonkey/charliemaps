import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrationsDir = path.resolve(process.cwd(), "../db/migrations");
    const files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const already = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [filename]
      );
      if (already.rowCount) continue;

      const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename]
      );
      await client.query("COMMIT");
      console.log(`applied migration ${filename}`);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
