import type { Type } from "@nestjs/common";
import type { EventsApi, ToolsApi } from "../api";

export type ApiImplementations = {
  eventsApi: Type<EventsApi>;
  toolsApi: Type<ToolsApi>;
};
