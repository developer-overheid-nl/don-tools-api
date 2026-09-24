import type { Pool, PoolClient } from "pg";

// Append-only: an applied migration is never edited, a schema change is a new entry.
const migrations: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "create_events",
    sql: `
      CREATE TABLE events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source text NOT NULL CHECK (source IN ('manual', 'pleio')),
        source_name text,
        external_id text,
        title text NOT NULL,
        summary text,
        location text,
        url text NOT NULL,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL CHECK (ends_at >= starts_at),
        source_updated_at timestamptz,
        hidden_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (source, source_name, external_id)
      );
      CREATE INDEX events_starts_at_idx ON events (starts_at) WHERE hidden_at IS NULL;
    `,
  },
];

// Arbitrary constants that identify this service's advisory locks in the shared cluster.
const MIGRATION_LOCK = 71_140_001;
export const HARVEST_LOCK = 71_140_002;

// Serialised with an advisory lock, so concurrent replicas cannot apply a migration twice.
export const migrate = async (pool: Pool, schema: string): Promise<number[]> => {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    // Checked first, because CREATE SCHEMA IF NOT EXISTS still requires CREATE on the database.
    const existing = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schema]);
    if (existing.rowCount === 0) await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`,
    );
    const { rows } = await client.query<{ version: number }>(`SELECT version FROM ${schema}.schema_migrations`);
    const applied = new Set(rows.map((row) => row.version));
    const newlyApplied: number[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await inTransaction(client, async () => {
        await client.query(migration.sql);
        await client.query(`INSERT INTO ${schema}.schema_migrations (version, name) VALUES ($1, $2)`, [
          migration.version,
          migration.name,
        ]);
      });
      newlyApplied.push(migration.version);
    }
    return newlyApplied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
};

export const inTransaction = async <T>(client: PoolClient, work: () => Promise<T>): Promise<T> => {
  await client.query("BEGIN");
  try {
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
};

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
