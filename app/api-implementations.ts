import type { Type } from "@nestjs/common";
import type { ToolsApi } from "../api";

/**
 * Provide this type to {@link ApiModule} to provide your API implementations
 **/
export type ApiImplementations = {
  toolsApi: Type<ToolsApi>;
};
