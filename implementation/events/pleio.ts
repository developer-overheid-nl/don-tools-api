import { isHttpUrl, parseDateTime } from "./datetime";
import type { HarvestedEvent } from "./repository";

// Pleio disables introspection, so this is a fixed query; event fields must be inside `... on Event`.
export const PLEIO_EVENTS_QUERY = `
query UpcomingEvents($offset: Int!, $limit: Int!) {
  activities(
    offset: $offset
    limit: $limit
    subtypes: ["event"]
    tagCategories: []
    orderBy: startDate
    orderDirection: asc
    sortPinned: false
    eventFilter: upcoming
  ) {
    total
    edges {
      entity {
        guid
        ... on Event {
          title
          excerpt
          url
          startDate
          endDate
          location
          timeUpdated
        }
      }
    }
  }
}`;

const PAGE_SIZE = 50;
const MAX_PAGES = 40;

type PleioEvent = {
  guid?: string;
  title?: string | null;
  excerpt?: string | null;
  url?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  timeUpdated?: string | null;
};

type PleioResponse = {
  data?: { activities?: { total?: number; edges?: { entity?: PleioEvent | null }[] } | null };
  errors?: { message?: string }[];
};

export type Fetch = typeof fetch;

// Limits of AgendaEventInput in the OAS; harvested events must satisfy the same response contract.
const MAX_TITLE = 300;
const MAX_SUMMARY = 2000;
const MAX_LOCATION = 300;
const MAX_URL = 2000;

// Pleio data is not typed at runtime, so non-strings are treated as missing.
const text = (value: unknown, maxLength: number): string | undefined => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1).trimEnd()}…` : trimmed;
};

const resolveUrl = (value: unknown, origin: string): string | undefined => {
  if (typeof value !== "string" || !value) return undefined;
  const url = URL.parse(value, origin)?.toString();
  return url && url.length <= MAX_URL && isHttpUrl(url) ? url : undefined;
};

export const toHarvestedEvent = (origin: string, entity: PleioEvent): HarvestedEvent | undefined => {
  const title = text(entity.title, MAX_TITLE);
  const url = resolveUrl(entity.url, origin);
  const startsAt = typeof entity.startDate === "string" ? parseDateTime(entity.startDate) : undefined;
  if (typeof entity.guid !== "string" || !entity.guid || !title || !startsAt || !url) return undefined;
  const endsAt = typeof entity.endDate === "string" ? parseDateTime(entity.endDate) : undefined;
  return {
    externalId: entity.guid,
    title,
    summary: text(entity.excerpt, MAX_SUMMARY),
    location: text(entity.location, MAX_LOCATION),
    url,
    startsAt,
    endsAt: endsAt && endsAt >= startsAt ? endsAt : startsAt,
    sourceUpdatedAt: typeof entity.timeUpdated === "string" ? parseDateTime(entity.timeUpdated) : undefined,
  };
};

const fetchPage = async (
  origin: string,
  offset: number,
  timeoutMs: number,
  fetchImpl: Fetch,
): Promise<{ total: number; edges: number; entities: PleioEvent[] }> => {
  const response = await fetchImpl(`${origin}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: PLEIO_EVENTS_QUERY, variables: { offset, limit: PAGE_SIZE } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Pleio ${origin} responded with ${response.status}`);
  const body = (await response.json()) as PleioResponse;
  if (body.errors?.length) {
    throw new Error(`Pleio ${origin} returned errors: ${body.errors.map((error) => error.message).join("; ")}`);
  }
  const activities = body.data?.activities;
  if (!activities) throw new Error(`Pleio ${origin} returned no activities`);
  const edges = activities.edges ?? [];
  return {
    total: activities.total ?? 0,
    edges: edges.length,
    entities: edges.flatMap((edge) => (edge.entity ? [edge.entity] : [])),
  };
};

export type UpcomingEvents = {
  events: HarvestedEvent[];
  // Guids of listed entities that could not be mapped; they still exist at the source.
  unmappedIds: string[];
  // Entities that could not be mapped, including those without a usable guid.
  skipped: number;
};

const mapEntity = (origin: string, entity: PleioEvent): HarvestedEvent | undefined => {
  try {
    return toHarvestedEvent(origin, entity);
  } catch {
    return undefined;
  }
};

// Fetches all upcoming events of one Pleio site; throws unless every page was read, so callers can trust completeness.
export const fetchUpcomingEvents = async (
  origin: string,
  { timeoutMs, fetchImpl = fetch }: { timeoutMs: number; fetchImpl?: Fetch },
): Promise<UpcomingEvents> => {
  const result: UpcomingEvents = { events: [], unmappedIds: [], skipped: 0 };
  for (let page = 0, offset = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`Pleio ${origin} has more than ${MAX_PAGES * PAGE_SIZE} upcoming events`);
    const { total, edges, entities } = await fetchPage(origin, offset, timeoutMs, fetchImpl);
    for (const entity of entities) {
      const event = mapEntity(origin, entity);
      if (event) {
        result.events.push(event);
        continue;
      }
      result.skipped++;
      if (typeof entity.guid === "string" && entity.guid) result.unmappedIds.push(entity.guid);
    }
    // Pagination counts edges, also those whose entity is null.
    offset += edges;
    if (edges === 0 || offset >= total) break;
  }
  return result;
};
