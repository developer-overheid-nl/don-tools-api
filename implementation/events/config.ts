import type { PoolConfig } from "pg";

export type EventsConfig = {
  database?: PoolConfig;
  schema: string;
  timeZone: string;
  publicBaseUrl?: string;
  harvest: {
    enabled: boolean;
    cron: string;
    sources: string[];
    timeoutMs: number;
  };
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseSources = (value: string | undefined): string[] =>
  (value ?? "https://digilab.pleio.nl")
    .split(",")
    .map((source) => source.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .map((source) => new URL(source).origin);

// Uses the DB_* variables of the registers; without DB_HOSTNAME the events endpoints are disabled.
export const loadEventsConfig = (env: NodeJS.ProcessEnv = process.env): EventsConfig => {
  const schema = env.DB_SCHEMA?.trim() || "public";
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`DB_SCHEMA is not a valid schema name: ${schema}`);

  return {
    database: env.DB_HOSTNAME
      ? {
          host: env.DB_HOSTNAME,
          port: parsePositiveInt(env.DB_PORT, 5432),
          user: env.DB_USERNAME,
          password: env.DB_PASSWORD,
          database: env.DB_DBNAME,
          options: `-c search_path=${schema}`,
          max: parsePositiveInt(env.DB_POOL_MAX, 5),
          connectionTimeoutMillis: 5_000,
        }
      : undefined,
    schema,
    timeZone: env.EVENTS_TIME_ZONE?.trim() || "Europe/Amsterdam",
    publicBaseUrl: env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || undefined,
    harvest: {
      enabled: parseBoolean(env.PLEIO_HARVEST_ENABLED, true),
      cron: env.PLEIO_HARVEST_CRON?.trim() || "0 6 * * *",
      sources: parseSources(env.PLEIO_SOURCES),
      timeoutMs: parsePositiveInt(env.PLEIO_TIMEOUT_MS, 30_000),
    },
  };
};
