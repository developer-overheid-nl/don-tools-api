import { describe, expect, it } from "vitest";
import { formatDateTime } from "../implementation/events/datetime.ts";
import { fetchUpcomingEvents, toHarvestedEvent } from "../implementation/events/pleio.ts";

const origin = "https://digilab.pleio.nl";

const entity = (guid: string, overrides: Record<string, unknown> = {}) => ({
  guid,
  title: ` Event ${guid} `,
  excerpt: "Korte omschrijving",
  url: `/events/view/${guid}/event`,
  startDate: "2026-10-06T15:30:00+02:00",
  endDate: "2026-10-06T16:45:00+02:00",
  location: "",
  timeUpdated: "2026-09-03T09:21:36.834683+00:00",
  ...overrides,
});

const pleioResponse = (total: number, entities: unknown[]) =>
  new Response(JSON.stringify({ data: { activities: { total, edges: entities.map((e) => ({ entity: e })) } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("toHarvestedEvent", () => {
  it("maps a Pleio event and resolves its relative url", () => {
    expect(toHarvestedEvent(origin, entity("a"))).toEqual({
      externalId: "a",
      title: "Event a",
      summary: "Korte omschrijving",
      location: undefined,
      url: "https://digilab.pleio.nl/events/view/a/event",
      startsAt: new Date("2026-10-06T13:30:00Z"),
      endsAt: new Date("2026-10-06T14:45:00Z"),
      sourceUpdatedAt: new Date("2026-09-03T09:21:36.834Z"),
    });
  });

  it("uses the start as end when the end is missing or before the start", () => {
    expect(toHarvestedEvent(origin, entity("a", { endDate: null }))?.endsAt).toEqual(new Date("2026-10-06T13:30:00Z"));
    expect(toHarvestedEvent(origin, entity("a", { endDate: "2026-10-01T10:00:00+02:00" }))?.endsAt).toEqual(
      new Date("2026-10-06T13:30:00Z"),
    );
  });

  it("skips entities that are not usable events", () => {
    expect(toHarvestedEvent(origin, { guid: "x" })).toBeUndefined();
    expect(toHarvestedEvent(origin, entity("a", { startDate: "not a date" }))).toBeUndefined();
    expect(toHarvestedEvent(origin, entity("a", { title: "  " }))).toBeUndefined();
  });
});

describe("fetchUpcomingEvents", () => {
  it("reads every page", async () => {
    const offsets: number[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const { variables } = JSON.parse(String(init.body)) as { variables: { offset: number } };
      offsets.push(variables.offset);
      const all = Array.from({ length: 60 }, (_, index) => entity(`e${index}`));
      return pleioResponse(all.length, all.slice(variables.offset, variables.offset + 50));
    }) as typeof fetch;

    const { events, skipped } = await fetchUpcomingEvents(origin, { timeoutMs: 1000, fetchImpl });

    expect(offsets).toEqual([0, 50]);
    expect(events).toHaveLength(60);
    expect(skipped).toBe(0);
  });

  it("fails on GraphQL errors, so a partial result never removes events", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "boom" }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchUpcomingEvents(origin, { timeoutMs: 1000, fetchImpl })).rejects.toThrow(/boom/);
  });

  it("fails on HTTP errors", async () => {
    const fetchImpl = (async () => new Response("", { status: 502 })) as unknown as typeof fetch;
    await expect(fetchUpcomingEvents(origin, { timeoutMs: 1000, fetchImpl })).rejects.toThrow(/502/);
  });
});

describe("formatDateTime", () => {
  it("includes the offset of the time zone, also across daylight saving time", () => {
    expect(formatDateTime(new Date("2026-07-01T10:00:00.123Z"), "Europe/Amsterdam")).toBe("2026-07-01T12:00:00+02:00");
    expect(formatDateTime(new Date("2026-12-01T10:00:00Z"), "Europe/Amsterdam")).toBe("2026-12-01T11:00:00+01:00");
    expect(formatDateTime(new Date("2026-12-01T10:00:00Z"), "UTC")).toBe("2026-12-01T10:00:00Z");
  });
});
