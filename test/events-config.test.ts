import { describe, expect, it } from "vitest";
import { loadEventsConfig } from "../implementation/events/config.ts";
import { isDatabaseUnavailable } from "../implementation/events/database.ts";

describe("loadEventsConfig", () => {
  it("uses defaults for an empty environment", () => {
    expect(loadEventsConfig({})).toEqual({
      database: undefined,
      timeZone: "Europe/Amsterdam",
      publicBaseUrl: undefined,
      harvest: { enabled: true, cron: "0 6 * * *", sources: ["https://digilab.pleio.nl"], timeoutMs: 30_000 },
    });
  });

  it("fails on invalid values instead of falling back", () => {
    expect(() => loadEventsConfig({ PLEIO_HARVEST_ENABLED: "flase" })).toThrow(/PLEIO_HARVEST_ENABLED/);
    expect(() => loadEventsConfig({ PLEIO_TIMEOUT_MS: "30s" })).toThrow(/PLEIO_TIMEOUT_MS/);
    expect(() => loadEventsConfig({ DB_HOSTNAME: "db", DB_POOL_MAX: "0" })).toThrow(/DB_POOL_MAX/);
    expect(() => loadEventsConfig({ EVENTS_TIME_ZONE: "Europe/Amsterdm" })).toThrow(/EVENTS_TIME_ZONE/);
    expect(() => loadEventsConfig({ PLEIO_HARVEST_CRON: "elke ochtend" })).toThrow(/PLEIO_HARVEST_CRON/);
    expect(() => loadEventsConfig({ PLEIO_SOURCES: "ftp://pleio.nl" })).toThrow(/PLEIO_SOURCES/);
    expect(() => loadEventsConfig({ DB_SCHEMA: "public; drop" })).toThrow(/DB_SCHEMA/);
  });

  it("parses explicit values", () => {
    const config = loadEventsConfig({
      PLEIO_HARVEST_ENABLED: "off",
      PLEIO_SOURCES: "https://a.pleio.nl/, https://b.pleio.nl/groups",
      PUBLIC_BASE_URL: "https://api.example.nl/tools/",
    });
    expect(config.harvest.enabled).toBe(false);
    expect(config.harvest.sources).toEqual(["https://a.pleio.nl", "https://b.pleio.nl"]);
    expect(config.publicBaseUrl).toBe("https://api.example.nl/tools");
  });
});

describe("isDatabaseUnavailable", () => {
  it("recognises outages but not bugs", () => {
    expect(isDatabaseUnavailable(Object.assign(new Error("relation does not exist"), { code: "42P01" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("terminating connection"), { code: "57P01" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDatabaseUnavailable(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("syntax error"), { code: "42601" }))).toBe(false);
    expect(isDatabaseUnavailable(new TypeError("x is undefined"))).toBe(false);
  });
});
