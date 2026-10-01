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
import { type EventAgenda, invoke, loadTools, type SourceHarvestResult } from "../don-tools";
import { type EventsConfig, loadEventsConfig } from "./config";

// Explicit fields instead of pino child bindings: the application logger's mixin would add a second `component`.
const logFields = (operation: string) => ({ component: "events", operation });

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// HTTP adapter and lifecycle (pool, harvest schedule, shutdown) of the events agenda; the rules live in don-tools.
@Injectable()
export class EventsService extends EventsApi implements OnModuleInit, OnApplicationShutdown {
  private readonly config: EventsConfig = loadEventsConfig();
  private readonly logger: Logger = createApplicationLogger();
  private pool?: Pool;
  private agenda?: EventAgenda;
  private harvestJob?: Cron;
  private runningHarvest?: Promise<SourceHarvestResult[] | undefined>;

  async onModuleInit(): Promise<void> {
    if (!this.config.database) {
      this.logger.warn(logFields("init"), "DB_HOSTNAME is not set; events endpoints are disabled");
      return;
    }
    if (!this.config.publicBaseUrl) {
      this.logger.warn(logFields("init"), "PUBLIC_BASE_URL is not set; Location and Link headers use the request host");
    }
    const { EventAgenda, EventsRepository } = await loadTools();
    const pool = new Pool(this.config.database);
    pool.on("error", (error) =>
      this.logger.error({ ...logFields("database"), error_message: error.message }, "idle database client failed"),
    );
    this.pool = pool;
    this.agenda = new EventAgenda(new EventsRepository(pool), this.config.timeZone);
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

  // Waits for a running harvest, so the pool is not ended under its queries.
  async onApplicationShutdown(): Promise<void> {
    this.harvestJob?.stop();
    await this.runningHarvest;
    await this.pool?.end();
  }

  harvest(): Promise<SourceHarvestResult[] | undefined> {
    this.runningHarvest ??= this.runHarvest().finally(() => {
      this.runningHarvest = undefined;
    });
    return this.runningHarvest;
  }

  private async runHarvest(): Promise<SourceHarvestResult[] | undefined> {
    const fields = logFields("pleio_harvest");
    try {
      if (!this.pool) throw new Error("Events are not configured");
      const { EventsRepository, runPleioHarvest } = await loadTools();
      const results = await runPleioHarvest(this.pool, new EventsRepository(this.pool), {
        sources: this.config.harvest.sources,
        timeoutMs: this.config.harvest.timeoutMs,
        logger: this.logger,
      });
      if (!results) this.logger.info(fields, "pleio harvest skipped; another instance is running it");
      return results;
    } catch (error) {
      this.logger.error({ ...fields, error_message: errorMessage(error) }, "pleio harvest failed");
      return undefined;
    }
  }

  // The schema is created by hand, outside this repository; the app never runs DDL.
  private async withAgenda<T>(work: (agenda: EventAgenda) => Promise<T>): Promise<T> {
    const agenda = this.agenda;
    if (!agenda) throw new ServiceUnavailableException("Events are not configured");
    try {
      return await invoke(() => work(agenda));
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 503) {
        const cause = error.cause as { code?: string; cause?: { code?: string; message?: string } } | undefined;
        this.logger.error(
          { ...logFields("query"), error_code: cause?.cause?.code, error_message: cause?.cause?.message },
          "events database is unavailable",
        );
      }
      throw error;
    }
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
    // Query values arrive as strings; the OAS already enforced their range and the controller their defaults.
    const result = await this.withAgenda((agenda) =>
      agenda.list({ page: Number(page), perPage: Number(perPage), endsAfter, startsBefore, source }),
    );
    reply
      .header("Link", this.paginationLinks(request, result.page, result.perPage, result.totalPages))
      .header("Total-Count", String(result.total))
      .header("Current-Page", String(result.page))
      .header("Per-Page", String(result.perPage))
      .header("Total-Pages", String(result.totalPages));
    return result.events;
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

  getEvent(id: string): Promise<AgendaEvent> {
    return this.withAgenda((agenda) => agenda.get(id));
  }

  async createEvent(input: AgendaEventInput, request: FastifyRequest, reply: FastifyReply): Promise<AgendaEvent> {
    const event = await this.withAgenda((agenda) => agenda.create(input));
    const path = `${request.url.split("?")[0]?.replace(/\/+$/, "")}/${event.id}`;
    reply.status(201).header("Location", this.resourceUrl(request, path));
    return event;
  }

  updateEvent(id: string, input: AgendaEventInput): Promise<AgendaEvent> {
    return this.withAgenda((agenda) => agenda.update(id, input));
  }

  async deleteEvent(id: string, _request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.withAgenda((agenda) => agenda.remove(id));
    reply.status(204);
  }
}
