import type { Pool } from "pg";
import type { AgendaEventSource } from "../../models";

export type EventRecord = {
  id: string;
  source: AgendaEventSource;
  sourceName: string | null;
  title: string;
  summary: string | null;
  location: string | null;
  url: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type EventFields = {
  title: string;
  summary?: string;
  location?: string;
  url: string;
  startsAt: Date;
  endsAt: Date;
};

export type HarvestedEvent = EventFields & {
  externalId: string;
  sourceUpdatedAt?: Date;
};

export type EventFilter = {
  endsAfter?: Date;
  startsBefore?: Date;
  source?: AgendaEventSource;
  limit: number;
  offset: number;
};

export type MutationResult = { status: "ok"; event: EventRecord } | { status: "not_found" } | { status: "harvested" };

type EventRow = {
  id: string;
  source: AgendaEventSource;
  source_name: string | null;
  title: string;
  summary: string | null;
  location: string | null;
  url: string;
  starts_at: Date;
  ends_at: Date;
  created_at: Date;
  updated_at: Date;
};

const columns = "id, source, source_name, title, summary, location, url, starts_at, ends_at, created_at, updated_at";

const toRecord = (row: EventRow): EventRecord => ({
  id: row.id,
  source: row.source,
  sourceName: row.source_name,
  title: row.title,
  summary: row.summary,
  location: row.location,
  url: row.url,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const orNull = (value: string | undefined): string | null => (value === undefined || value === "" ? null : value);

export class EventsRepository {
  constructor(private readonly pool: Pool) {}

  async list(filter: EventFilter): Promise<{ events: EventRecord[]; total: number }> {
    const where = [
      "hidden_at IS NULL",
      "($1::timestamptz IS NULL OR ends_at >= $1)",
      "($2::timestamptz IS NULL OR starts_at < $2)",
      "($3::text IS NULL OR source = $3)",
    ].join(" AND ");
    const parameters = [filter.endsAfter ?? null, filter.startsBefore ?? null, filter.source ?? null];
    const [page, count] = await Promise.all([
      this.pool.query<EventRow>(
        `SELECT ${columns} FROM events WHERE ${where} ORDER BY starts_at, id LIMIT $4 OFFSET $5`,
        [...parameters, filter.limit, filter.offset],
      ),
      this.pool.query<{ total: string }>(`SELECT count(*) AS total FROM events WHERE ${where}`, parameters),
    ]);
    return { events: page.rows.map(toRecord), total: Number(count.rows[0]?.total ?? 0) };
  }

  async get(id: string): Promise<EventRecord | undefined> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT ${columns} FROM events WHERE id = $1 AND hidden_at IS NULL`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async create(fields: EventFields): Promise<EventRecord> {
    const { rows } = await this.pool.query<EventRow>(
      `INSERT INTO events (source, title, summary, location, url, starts_at, ends_at)
       VALUES ('manual', $1, $2, $3, $4, $5, $6)
       RETURNING ${columns}`,
      [fields.title, orNull(fields.summary), orNull(fields.location), fields.url, fields.startsAt, fields.endsAt],
    );
    return toRecord(rows[0] as EventRow);
  }

  async update(id: string, fields: EventFields): Promise<MutationResult> {
    const { rows } = await this.pool.query<EventRow>(
      `UPDATE events
       SET title = $2, summary = $3, location = $4, url = $5, starts_at = $6, ends_at = $7, updated_at = now()
       WHERE id = $1 AND source = 'manual' AND hidden_at IS NULL
       RETURNING ${columns}`,
      [id, fields.title, orNull(fields.summary), orNull(fields.location), fields.url, fields.startsAt, fields.endsAt],
    );
    if (rows[0]) return { status: "ok", event: toRecord(rows[0]) };
    return (await this.get(id)) ? { status: "harvested" } : { status: "not_found" };
  }

  // Manual events are removed; harvested events are hidden, so the next harvest does not bring them back.
  async remove(id: string): Promise<boolean> {
    const deleted = await this.pool.query("DELETE FROM events WHERE id = $1 AND source = 'manual'", [id]);
    if (deleted.rowCount) return true;
    const hidden = await this.pool.query(
      "UPDATE events SET hidden_at = now(), updated_at = now() WHERE id = $1 AND hidden_at IS NULL",
      [id],
    );
    return Boolean(hidden.rowCount);
  }

  // Inserts new events and refreshes changed ones (always when the source gives no timeUpdated); hidden_at is left untouched.
  async upsertHarvested(sourceName: string, event: HarvestedEvent): Promise<"inserted" | "updated" | "unchanged"> {
    const { rows } = await this.pool.query<{ inserted: boolean }>(
      `INSERT INTO events (source, source_name, external_id, title, summary, location, url, starts_at, ends_at, source_updated_at)
       VALUES ('pleio', $1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (source, source_name, external_id) DO UPDATE SET
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         location = EXCLUDED.location,
         url = EXCLUDED.url,
         starts_at = EXCLUDED.starts_at,
         ends_at = EXCLUDED.ends_at,
         source_updated_at = EXCLUDED.source_updated_at,
         updated_at = now()
       WHERE EXCLUDED.source_updated_at IS NULL OR events.source_updated_at IS DISTINCT FROM EXCLUDED.source_updated_at
       RETURNING (xmax = 0) AS inserted`,
      [
        sourceName,
        event.externalId,
        event.title,
        orNull(event.summary),
        orNull(event.location),
        event.url,
        event.startsAt,
        event.endsAt,
        event.sourceUpdatedAt ?? null,
      ],
    );
    if (!rows[0]) return "unchanged";
    return rows[0].inserted ? "inserted" : "updated";
  }

  // Removes future events that the source no longer lists (cancelled or deleted there); past events are kept.
  async removeVanished(sourceName: string, seenExternalIds: string[]): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM events
       WHERE source = 'pleio' AND source_name = $1 AND starts_at > now() AND NOT (external_id = ANY($2::text[]))`,
      [sourceName, seenExternalIds],
    );
    return rowCount ?? 0;
  }
}
