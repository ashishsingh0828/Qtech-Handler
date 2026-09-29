import pg from 'pg';
import { env } from './config/env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30000,
});

export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already failed */
    }
    throw error;
  } finally {
    client.release();
  }
}
