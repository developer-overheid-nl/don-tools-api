import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Observable } from "rxjs";
import { EventsApi } from "../api";
import type { AgendaEvent, AgendaEventInput, AgendaEventSource } from "../models";

@Controller()
export class EventsApiController {
  constructor(@Inject(EventsApi) private readonly eventsApi: EventsApi) {}

  @Post("/v1/events")
  createEvent(
    @Body() agendaEventInput: AgendaEventInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): AgendaEvent | Promise<AgendaEvent> | Observable<AgendaEvent> {
    return this.eventsApi.createEvent(agendaEventInput, request, reply);
  }

  @Delete("/v1/events/:id")
  deleteEvent(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): void | Promise<void> | Observable<void> {
    return this.eventsApi.deleteEvent(id, request, reply);
  }

  @Get("/v1/events/:id")
  getEvent(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): AgendaEvent | Promise<AgendaEvent> | Observable<AgendaEvent> {
    return this.eventsApi.getEvent(id, request, reply);
  }

  @Get("/v1/events")
  listEvents(
    @Query("page", new DefaultValuePipe(1)) page: number | undefined,
    @Query("perPage", new DefaultValuePipe(20)) perPage: number | undefined,
    @Query("endsAfter") endsAfter: string | undefined,
    @Query("startsBefore") startsBefore: string | undefined,
    @Query("source") source: AgendaEventSource | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Array<AgendaEvent> | Promise<Array<AgendaEvent>> | Observable<Array<AgendaEvent>> {
    return this.eventsApi.listEvents(page, perPage, endsAfter, startsBefore, source, request, reply);
  }

  @Put("/v1/events/:id")
  updateEvent(
    @Param("id") id: string,
    @Body() agendaEventInput: AgendaEventInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): AgendaEvent | Promise<AgendaEvent> | Observable<AgendaEvent> {
    return this.eventsApi.updateEvent(id, agendaEventInput, request, reply);
  }
}
