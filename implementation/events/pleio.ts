import { parseDateTime } from "./datetime";
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

const trimmed = (value: string | null | undefined): string | undefined => value?.trim() || undefined;

export const toHarvestedEvent = (origin: string, entity: PleioEvent): HarvestedEvent | undefined => {
  const title = trimmed(entity.title);
  const startsAt = entity.startDate ? parseDateTime(entity.startDate) : undefined;
  if (!entity.guid || !title || !startsAt || !entity.url) return undefined;
  const endsAt = entity.endDate ? parseDateTime(entity.endDate) : undefined;
  return {
    externalId: entity.guid,
    title,
    summary: trimmed(entity.excerpt),
    location: trimmed(entity.location),
    url: new URL(entity.url, origin).toString(),
    startsAt,
    endsAt: endsAt && endsAt >= startsAt ? endsAt : startsAt,
    sourceUpdatedAt: entity.timeUpdated ? parseDateTime(entity.timeUpdated) : undefined,
  };
};

const fetchPage = async (
  origin: string,
  offset: number,
  timeoutMs: number,
  fetchImpl: Fetch,
): Promise<{ total: number; entities: PleioEvent[] }> => {
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
  return {
    total: activities.total ?? 0,
    entities: (activities.edges ?? []).flatMap((edge) => (edge.entity ? [edge.entity] : [])),
  };
};

// Fetches all upcoming events of one Pleio site; throws unless every page was read, so callers can trust completeness.
export const fetchUpcomingEvents = async (
  origin: string,
  { timeoutMs, fetchImpl = fetch }: { timeoutMs: number; fetchImpl?: Fetch },
): Promise<{ events: HarvestedEvent[]; skipped: number }> => {
  const events: HarvestedEvent[] = [];
  let skipped = 0;
  for (let page = 0, offset = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`Pleio ${origin} has more than ${MAX_PAGES * PAGE_SIZE} upcoming events`);
    const { total, entities } = await fetchPage(origin, offset, timeoutMs, fetchImpl);
    for (const entity of entities) {
      const event = toHarvestedEvent(origin, entity);
      if (event) events.push(event);
      else skipped++;
    }
    offset += entities.length;
    if (entities.length === 0 || offset >= total) break;
  }
  return { events, skipped };
};
