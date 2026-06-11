import { Type } from '@nestjs/common';
import { ToolsApi } from './api';

/**
 * Provide this type to {@link ApiModule} to provide your API implementations
**/
export type ApiImplementations = {
  toolsApi: Type<ToolsApi>
};
