import {
  HttpException,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Cron } from "croner";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Pool } from "pg";
import type { Logger } from "pino";
import { EventsApi } from "../../api";
import { createApplicationLogger } from "../../app/logging";
import type { AgendaEvent, AgendaEventInput, AgendaEventSource } from "../../models";
import { type EventsConfig, loadEventsConfig } from "./config";
import { HARVEST_LOCK, migrate, withAdvisoryLock } from "./database";
import { formatDateTime, parseDateTime } from "./datetime";
import { harvestPleio, type SourceHarvestResult } from "./harvester";
import { type EventFields, type EventRecord, EventsRepository } from "./repository";

const toPositiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const notFound = (id: string) => new HttpException(`Event ${id} does not exist`, 404);

@Injectable()
export class EventsService extends EventsApi implements OnModuleInit, OnApplicationShutdown {
  private readonly config: EventsConfig = loadEventsConfig();
  private readonly logger: Logger = createApplicationLogger();
  private pool?: Pool;
  private repository?: EventsRepository;
  private ready?: Promise<EventsRepository>;
  private harvestJob?: Cron;

  onModuleInit(): void {
    if (!this.config.database) {
      this.logger.warn(
        { component: "events", operation: "init" },
        "DB_HOSTNAME is not set; events endpoints are disabled",
      );
      return;
    }
    this.pool = new Pool(this.config.database);
    this.pool.on("error", (error) =>
      this.logger.error(
        { component: "events", operation: "database", error_message: error.message },
        "idle database client failed",
      ),
    );
    this.repository = new EventsRepository(this.pool);
    if (!this.config.harvest.enabled || this.config.harvest.sources.length === 0) return;
    this.harvestJob = new Cron(
      this.config.harvest.cron,
      { protect: true, timezone: this.config.timeZone, name: "pleio-harvest" },
      async () => {
        await this.harvest();
      },
    );
    void this.harvest();
  }

  async onApplicationShutdown(): Promise<void> {
    this.harvestJob?.stop();
    await this.pool?.end();
  }

  // Migrates once; a failure is retried on the next call, so a database that starts late recovers without a restart.
  private ensureReady(): Promise<EventsRepository> {
    const pool = this.pool;
    const repository = this.repository;
    if (!pool || !repository) return Promise.reject(new ServiceUnavailableException("Events are not configured"));
    this.ready ??= migrate(pool, this.config.schema).then(
      (applied) => {
        if (applied.length > 0)
          this.logger.info({ component: "events", operation: "migrate", versions: applied }, "database migrated");
        return repository;
      },
      (error: unknown) => {
        this.ready = undefined;
        this.logger.error(
          {
            component: "events",
            operation: "migrate",
            error_message: error instanceof Error ? error.message : String(error),
          },
          "database migration failed",
        );
        throw new ServiceUnavailableException("Events database is unavailable");
      },
    );
    return this.ready;
  }

  private async withRepository<T>(work: (repository: EventsRepository) => Promise<T>): Promise<T> {
    const repository = await this.ensureReady();
    try {
      return await work(repository);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        {
          component: "events",
          operation: "query",
          error_message: error instanceof Error ? error.message : String(error),
        },
        "events query failed",
      );
      throw new ServiceUnavailableException("Events database is unavailable");
    }
  }

  async harvest(): Promise<SourceHarvestResult[] | undefined> {
    const fields = { component: "events", operation: "pleio_harvest" };
    try {
      const repository = await this.ensureReady();
      const pool = this.pool as Pool;
      const results = await withAdvisoryLock(pool, HARVEST_LOCK, () =>
        harvestPleio(repository, this.config.harvest.sources, this.logger, {
          timeoutMs: this.config.harvest.timeoutMs,
        }),
      );
      if (!results) this.logger.info(fields, "pleio harvest skipped; another instance is running it");
      return results;
    } catch (error) {
      this.logger.error(
        { ...fields, error_message: error instanceof Error ? error.message : String(error) },
        "pleio harvest failed",
      );
      return undefined;
    }
  }

  private toEvent(record: EventRecord): AgendaEvent {
    const { timeZone } = this.config;
    return {
      id: record.id,
      title: record.title,
      ...(record.summary ? { summary: record.summary } : {}),
      startsAt: formatDateTime(record.startsAt, timeZone),
      endsAt: formatDateTime(record.endsAt, timeZone),
      ...(record.location ? { location: record.location } : {}),
      url: record.url,
      source: record.source,
      ...(record.sourceName ? { sourceName: record.sourceName } : {}),
      createdAt: formatDateTime(record.createdAt, timeZone),
      updatedAt: formatDateTime(record.updatedAt, timeZone),
    };
  }

  private toFields(input: AgendaEventInput): EventFields {
    const startsAt = parseDateTime(input.startsAt);
    const endsAt = parseDateTime(input.endsAt);
    if (!startsAt || !endsAt) throw new HttpException("startsAt and endsAt must be RFC 3339 date-times", 400);
    if (endsAt < startsAt) throw new HttpException("endsAt must not be before startsAt", 400);
    return {
      title: input.title.trim(),
      summary: input.summary?.trim(),
      location: input.location?.trim(),
      url: input.url,
      startsAt,
      endsAt,
    };
  }

  // PUBLIC_BASE_URL is the gateway prefix (e.g. https://api.developer.overheid.nl/tools); locally the request origin.
  private resourceUrl(request: FastifyRequest, path: string): string {
    return `${this.config.publicBaseUrl ?? `${request.protocol}://${request.host}`}${path}`;
  }

  async listEvents(
    page: number | undefined,
    perPage: number | undefined,
    endsAfter: string | undefined,
    startsBefore: string | undefined,
    source: AgendaEventSource | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AgendaEvent[]> {
    const currentPage = toPositiveInt(page, 1);
    const pageSize = Math.min(toPositiveInt(perPage, 20), 100);
    const { events, total } = await this.withRepository((repository) =>
      repository.list({
        endsAfter: endsAfter ? parseDateTime(endsAfter) : undefined,
        startsBefore: startsBefore ? parseDateTime(startsBefore) : undefined,
        source,
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
      }),
    );
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    reply
      .header("Link", this.paginationLinks(request, currentPage, pageSize, totalPages))
      .header("Total-Count", String(total))
      .header("Current-Page", String(currentPage))
      .header("Per-Page", String(pageSize))
      .header("Total-Pages", String(totalPages));
    return events.map((event) => this.toEvent(event));
  }

  private paginationLinks(request: FastifyRequest, currentPage: number, perPage: number, totalPages: number): string {
    const url = new URL(request.url, "http://localhost");
    const link = (page: number, rel: string) => {
      url.searchParams.set("page", String(page));
      url.searchParams.set("perPage", String(perPage));
      return `<${this.resourceUrl(request, `${url.pathname}${url.search}`)}>; rel="${rel}"`;
    };
    return [
      link(1, "first"),
      ...(currentPage > 1 ? [link(Math.min(currentPage - 1, totalPages), "prev")] : []),
      ...(currentPage < totalPages ? [link(currentPage + 1, "next")] : []),
      link(totalPages, "last"),
    ].join(", ");
  }

  async getEvent(id: string): Promise<AgendaEvent> {
    const event = await this.withRepository((repository) => repository.get(id));
    if (!event) throw notFound(id);
    return this.toEvent(event);
  }

  async createEvent(input: AgendaEventInput, request: FastifyRequest, reply: FastifyReply): Promise<AgendaEvent> {
    const fields = this.toFields(input);
    const event = await this.withRepository((repository) => repository.create(fields));
    const path = `${request.url.split("?")[0]?.replace(/\/+$/, "")}/${event.id}`;
    reply.status(201).header("Location", this.resourceUrl(request, path));
    return this.toEvent(event);
  }

  async updateEvent(id: string, input: AgendaEventInput): Promise<AgendaEvent> {
    const fields = this.toFields(input);
    const result = await this.withRepository((repository) => repository.update(id, fields));
    if (result.status === "not_found") throw notFound(id);
    if (result.status === "harvested") {
      throw new HttpException(`Event ${id} is harvested and can only be changed at its source`, 409);
    }
    return this.toEvent(result.event);
  }

  async deleteEvent(id: string, _request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const removed = await this.withRepository((repository) => repository.remove(id));
    if (!removed) throw notFound(id);
    reply.status(204);
  }
}
