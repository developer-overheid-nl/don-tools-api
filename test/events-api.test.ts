import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Pool } from "pg";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app/index.ts";
import { harvestPleio } from "../implementation/events/harvester.ts";
import { EventsRepository } from "../implementation/events/repository.ts";

// Runs against a real PostgreSQL, e.g.: docker run --rm -p 55432:5432 -e POSTGRES_PASSWORD=don postgres:17
// TEST_DB_HOSTNAME=localhost TEST_DB_PORT=55432 TEST_DB_USERNAME=postgres TEST_DB_PASSWORD=don TEST_DB_DBNAME=postgres npm test
const testDatabase = process.env.TEST_DB_HOSTNAME;
const schema = `events_test_${process.pid}`;

let app: NestFastifyApplication;
let pool: Pool;

const inject = (options: { method: string; url: string; payload?: unknown }) =>
  app.getHttpAdapter().getInstance().inject(options);

const manualEvent = {
  title: "PGDay Lowlands 2026",
  summary: "PostgreSQL-conferentie",
  startsAt: "2026-09-10T09:00:00+02:00",
  endsAt: "2026-09-10T17:00:00+02:00",
  location: "TivoliVredenburg, Utrecht",
  url: "https://2026.pgday.nl/",
};

const pleioEntity = (guid: string, startDate: string, timeUpdated = "2026-09-01T10:00:00+00:00") => ({
  guid,
  title: `Pleio ${guid}`,
  excerpt: "Uit Pleio",
  url: `/events/view/${guid}`,
  startDate,
  endDate: startDate,
  location: "Online",
  timeUpdated,
});

const pleioFetch = (entities: unknown[]) =>
  (async () =>
    new Response(
      JSON.stringify({
        data: { activities: { total: entities.length, edges: entities.map((entity) => ({ entity })) } },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

describe.skipIf(!testDatabase)("events API with PostgreSQL", () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DB_HOSTNAME: testDatabase,
      DB_PORT: process.env.TEST_DB_PORT ?? "5432",
      DB_USERNAME: process.env.TEST_DB_USERNAME,
      DB_PASSWORD: process.env.TEST_DB_PASSWORD,
      DB_DBNAME: process.env.TEST_DB_DBNAME,
      DB_SCHEMA: schema,
      PLEIO_HARVEST_ENABLED: "false",
      PUBLIC_BASE_URL: "https://api.example.nl/tools",
    });
    app = await createApp();
    await app.init();
    pool = new Pool({
      host: testDatabase,
      port: Number(process.env.TEST_DB_PORT ?? 5432),
      user: process.env.TEST_DB_USERNAME,
      password: process.env.TEST_DB_PASSWORD,
      database: process.env.TEST_DB_DBNAME,
      options: `-c search_path=${schema}`,
    });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool?.end();
  });

  it("creates, reads, updates and deletes a manual event", async () => {
    const created = await inject({ method: "POST", url: "/v1/events", payload: manualEvent });
    expect(created.statusCode).toBe(201);
    const event = created.json() as { id: string; source: string; startsAt: string; createdAt: string };
    expect(event).toMatchObject({ ...manualEvent, source: "manual" });
    expect(event.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(created.headers.location).toBe(`https://api.example.nl/tools/v1/events/${event.id}`);

    const fetched = await inject({ method: "GET", url: `/v1/events/${event.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(event);

    const updated = await inject({
      method: "PUT",
      url: `/v1/events/${event.id}`,
      payload: { ...manualEvent, title: "PGDay Lowlands", summary: undefined },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: event.id, title: "PGDay Lowlands" });
    expect(updated.json()).not.toHaveProperty("summary");

    expect((await inject({ method: "DELETE", url: `/v1/events/${event.id}` })).statusCode).toBe(204);
    expect((await inject({ method: "GET", url: `/v1/events/${event.id}` })).statusCode).toBe(404);
    expect((await inject({ method: "DELETE", url: `/v1/events/${event.id}` })).statusCode).toBe(404);
  });

  it("normalises the offset of input date-times to the configured time zone", async () => {
    const created = await inject({
      method: "POST",
      url: "/v1/events",
      payload: { ...manualEvent, startsAt: "2026-09-10T07:00:00Z", endsAt: "2026-09-10T15:00:00Z" },
    });
    expect(created.json()).toMatchObject({
      startsAt: "2026-09-10T09:00:00+02:00",
      endsAt: "2026-09-10T17:00:00+02:00",
    });
    await inject({ method: "DELETE", url: `/v1/events/${(created.json() as { id: string }).id}` });
  });

  it("rejects invalid input", async () => {
    const reversed = await inject({
      method: "POST",
      url: "/v1/events",
      payload: { ...manualEvent, endsAt: "2026-09-10T08:00:00+02:00" },
    });
    expect(reversed.statusCode).toBe(400);
    expect(reversed.headers["content-type"]).toContain("application/problem+json");

    const withoutOffset = await inject({
      method: "POST",
      url: "/v1/events",
      payload: { ...manualEvent, startsAt: "2026-09-10T09:00:00" },
    });
    expect(withoutOffset.statusCode).toBe(400);

    expect((await inject({ method: "GET", url: "/v1/events/not-a-uuid" })).statusCode).toBe(400);
  });

  it("filters, sorts and paginates the list", async () => {
    const ids: string[] = [];
    for (const [day, title] of [
      ["12", "Derde"],
      ["10", "Eerste"],
      ["11", "Tweede"],
    ]) {
      const response = await inject({
        method: "POST",
        url: "/v1/events",
        payload: {
          ...manualEvent,
          title,
          startsAt: `2026-11-${day}T10:00:00+01:00`,
          endsAt: `2026-11-${day}T12:00:00+01:00`,
        },
      });
      ids.push((response.json() as { id: string }).id);
    }

    const page = await inject({ method: "GET", url: "/v1/events?endsAfter=2026-11-01T00:00:00%2B01:00&perPage=2" });
    expect(page.statusCode).toBe(200);
    expect((page.json() as { title: string }[]).map((event) => event.title)).toEqual(["Eerste", "Tweede"]);
    expect(page.headers).toMatchObject({
      "total-count": "3",
      "total-pages": "2",
      "current-page": "1",
      "per-page": "2",
    });
    expect(page.headers.link).toContain(
      '<https://api.example.nl/tools/v1/events?endsAfter=2026-11-01T00%3A00%3A00%2B01%3A00&perPage=2&page=2>; rel="next"',
    );

    const secondPage = await inject({
      method: "GET",
      url: "/v1/events?endsAfter=2026-11-01T00:00:00%2B01:00&perPage=2&page=2",
    });
    expect((secondPage.json() as { title: string }[]).map((event) => event.title)).toEqual(["Derde"]);

    const bounded = await inject({ method: "GET", url: "/v1/events?startsBefore=2026-11-11T00:00:00%2B01:00" });
    expect((bounded.json() as { title: string }[]).map((event) => event.title)).toEqual(["Eerste"]);

    for (const id of ids) await inject({ method: "DELETE", url: `/v1/events/${id}` });
  });

  it("harvests Pleio events idempotently and protects them against edits", async () => {
    const repository = new EventsRepository(pool);
    const logger = pino({ level: "silent" });
    const future = "2099-01-01T10:00:00+01:00";
    const later = "2099-01-02T10:00:00+01:00";
    const run = (entities: unknown[]) =>
      harvestPleio(repository, ["https://digilab.pleio.nl"], logger, {
        timeoutMs: 1000,
        fetchImpl: pleioFetch(entities),
      });

    expect(await run([pleioEntity("a", future), pleioEntity("b", later)])).toEqual([
      { source: "digilab.pleio.nl", inserted: 2, updated: 0, unchanged: 0, removed: 0, skipped: 0 },
    ]);
    expect(await run([pleioEntity("a", future), pleioEntity("b", later, "2026-09-02T10:00:00+00:00")])).toMatchObject([
      { inserted: 0, updated: 1, unchanged: 1 },
    ]);

    const list = await inject({ method: "GET", url: "/v1/events?source=pleio" });
    const [first] = list.json() as { id: string; url: string; sourceName: string }[];
    expect(first).toMatchObject({ url: "https://digilab.pleio.nl/events/view/a", sourceName: "digilab.pleio.nl" });

    const put = await inject({ method: "PUT", url: `/v1/events/${first?.id}`, payload: manualEvent });
    expect(put.statusCode).toBe(409);

    expect((await inject({ method: "DELETE", url: `/v1/events/${first?.id}` })).statusCode).toBe(204);
    await run([pleioEntity("a", future, "2026-09-05T10:00:00+00:00"), pleioEntity("b", later)]);
    expect((await inject({ method: "GET", url: `/v1/events/${first?.id}` })).statusCode).toBe(404);

    expect(await run([pleioEntity("a", future), { guid: "broken" }])).toMatchObject([{ skipped: 1, removed: 0 }]);
    expect(await run([pleioEntity("a", future)])).toMatchObject([{ removed: 1 }]);

    const withoutTimeUpdated = { ...pleioEntity("a", future), timeUpdated: null };
    await run([withoutTimeUpdated]);
    expect(await run([{ ...withoutTimeUpdated, title: "Nieuwe titel" }])).toMatchObject([{ updated: 1 }]);
    const remaining = await inject({ method: "GET", url: "/v1/events?source=pleio" });
    expect(remaining.json()).toEqual([]);
  });
});
