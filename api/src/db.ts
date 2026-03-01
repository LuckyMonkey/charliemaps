import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({ connectionString: databaseUrl });

export async function query<T = unknown>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}
