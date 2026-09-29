import type { Pool } from "pg";

// Arbitrary constant that identifies the harvest lock in the shared cluster.
export const HARVEST_LOCK = 71_140_002;

// Runs work only if no other replica holds the lock; returns undefined when skipped.
export const withAdvisoryLock = async <T>(pool: Pool, lock: number, work: () => Promise<T>): Promise<T | undefined> => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [lock]);
    if (!rows[0]?.locked) return undefined;
    try {
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [lock]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
};
