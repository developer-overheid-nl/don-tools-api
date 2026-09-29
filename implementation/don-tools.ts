import { HttpException } from "@nestjs/common";

// don-tools is an ES module; this CommonJS build can only load it with a dynamic import.
export const loadTools = () => import("@developer-overheid-nl/don-tools");

// Types of the ES module, derived from the dynamic import (a type-only import would need a resolution-mode attribute).
type DonTools = Awaited<ReturnType<typeof loadTools>>;
export type EventAgenda = InstanceType<DonTools["EventAgenda"]>;
export type SourceHarvestResult = NonNullable<Awaited<ReturnType<DonTools["runPleioHarvest"]>>>[number];

// Maps the HttpErrors of don-tools to Nest exceptions, so the global filter renders them as problem+json.
export const invoke = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    const { HttpError } = await loadTools();
    if (error instanceof HttpError) throw new HttpException(error.detail, error.status, { cause: error });
    throw error;
  }
};
