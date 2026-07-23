import { Pool } from 'pg';

// Railway Postgres needs rejectUnauthorized:false unless a CA cert is configured;
// set DATABASE_SSL_STRICT=true to enforce TLS certificate verification.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: process.env.DATABASE_SSL_STRICT === 'true' }
      : false,
});

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
