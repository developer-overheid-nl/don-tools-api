import type { Type } from "@nestjs/common";
import type { ToolsApi } from "../api";

export type ApiImplementations = {
  toolsApi: Type<ToolsApi>;
};
