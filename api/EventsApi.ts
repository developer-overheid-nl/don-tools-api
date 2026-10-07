import { Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Observable } from "rxjs";
import type { AgendaEvent, AgendaEventInput, AgendaEventSource } from "../models";

@Injectable()
export abstract class EventsApi {
  abstract createEvent(
    agendaEventInput: AgendaEventInput,
    request: FastifyRequest,
    reply: FastifyReply,
  ): AgendaEvent | Promise<AgendaEvent> | Observable<AgendaEvent>;
  abstract deleteEvent(
    id: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void | Promise<void> | Observable<void>;
  abstract getEvent(
    id: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): AgendaEvent | Promise<AgendaEvent> | Observable<AgendaEvent>;
  abstract listEvents(
    page: number | undefined,
    perPage: number | undefined,
    endsAfter: string | undefined,
    startsBefore: string | undefined,
    source: AgendaEventSource | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Array<AgendaEvent> | Promise<Array<AgendaEvent>> | Observable<Array<AgendaEvent>>;
  abstract updateEvent(
    id: string,
    agendaEventInput: AgendaEventInput,
    request: FastifyRequest,
    reply: FastifyReply,
  ): AgendaEvent | Promise<AgendaEvent> | Observable<AgendaEvent>;
}
