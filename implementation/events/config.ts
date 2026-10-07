import { Cron } from "croner";
import type { PoolConfig } from "pg";

export type EventsConfig = {
  database?: PoolConfig;
  timeZone: string;
  publicBaseUrl?: string;
  harvest: {
    enabled: boolean;
    cron: string;
    sources: string[];
    timeoutMs: number;
  };
};

// Invalid values fail at startup instead of silently falling back to a default.
const parseBoolean = (name: string, value: string | undefined, fallback: boolean): boolean => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean: ${value}`);
};

const parsePositiveInt = (name: string, value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer: ${value}`);
  return parsed;
};

const parseSources = (value: string | undefined): string[] =>
  (value ?? "https://digilab.pleio.nl")
    .split(",")
    .map((source) => source.trim())
    .filter(Boolean)
    .map((source) => {
      const url = new URL(source);
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error(`PLEIO_SOURCES has no http(s) url: ${source}`);
      return url.origin;
    });

const parseTimeZone = (value: string | undefined): string => {
  const timeZone = value?.trim() || "Europe/Amsterdam";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(`EVENTS_TIME_ZONE is not a valid time zone: ${timeZone}`);
  }
  return timeZone;
};

const parseCron = (value: string | undefined, timezone: string): string => {
  const pattern = value?.trim() || "0 6 * * *";
  try {
    new Cron(pattern, { paused: true, timezone }).stop();
  } catch (error) {
    throw new Error(`PLEIO_HARVEST_CRON is not a valid cron pattern: ${pattern}`, { cause: error });
  }
  return pattern;
};

// Uses the DB_* variables of the registers; without DB_HOSTNAME the events endpoints are disabled.
export const loadEventsConfig = (env: NodeJS.ProcessEnv = process.env): EventsConfig => {
  const schema = env.DB_SCHEMA?.trim() || "public";
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`DB_SCHEMA is not a valid schema name: ${schema}`);
  const timeZone = parseTimeZone(env.EVENTS_TIME_ZONE);

  return {
    database: env.DB_HOSTNAME
      ? {
          host: env.DB_HOSTNAME,
          port: parsePositiveInt("DB_PORT", env.DB_PORT, 5432),
          user: env.DB_USERNAME,
          password: env.DB_PASSWORD,
          database: env.DB_DBNAME,
          options: `-c search_path=${schema}`,
          max: parsePositiveInt("DB_POOL_MAX", env.DB_POOL_MAX, 5),
          connectionTimeoutMillis: 5_000,
        }
      : undefined,
    timeZone,
    publicBaseUrl: env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || undefined,
    harvest: {
      enabled: parseBoolean("PLEIO_HARVEST_ENABLED", env.PLEIO_HARVEST_ENABLED, true),
      cron: parseCron(env.PLEIO_HARVEST_CRON, timeZone),
      sources: parseSources(env.PLEIO_SOURCES),
      timeoutMs: parsePositiveInt("PLEIO_TIMEOUT_MS", env.PLEIO_TIMEOUT_MS, 30_000),
    },
  };
};
