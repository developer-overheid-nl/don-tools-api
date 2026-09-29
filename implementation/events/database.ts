import type { Pool } from "pg";

// Advisory locks are cluster-wide per database, so the key includes the schema: environments sharing a database
// (one DB_SCHEMA each) must not block each other's harvest.
export const HARVEST_LOCK = "events_harvest";

const unavailableCodes = /^(08|53300|57P0|42P01)/;
const unavailableSystemCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);

// True for errors that mean the database cannot serve requests (connection, capacity, missing table), not for bugs.
export const isDatabaseUnavailable = (error: unknown): boolean => {
  if (error instanceof Error && error.message.includes("timeout exceeded when trying to connect")) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && (unavailableCodes.test(code) || unavailableSystemCodes.has(code));
};

// Runs work only if no other replica holds the lock; returns undefined when skipped.
export const withAdvisoryLock = async <T>(pool: Pool, lock: string, work: () => Promise<T>): Promise<T | undefined> => {
  const client = await pool.connect();
  const key = "hashtext($1), hashtext(current_schema())";
  try {
    const { rows } = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(${key}) AS locked`, [lock]);
    if (!rows[0]?.locked) return undefined;
    try {
      return await work();
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${key})`, [lock]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
};
