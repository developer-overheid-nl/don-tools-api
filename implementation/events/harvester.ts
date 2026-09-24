import type { Logger } from "pino";
import { type Fetch, fetchUpcomingEvents } from "./pleio";
import type { EventsRepository } from "./repository";

export type SourceHarvestResult = {
  source: string;
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
  skipped: number;
};

// Harvests each source independently: a failing source is logged and leaves its stored events untouched.
export const harvestPleio = async (
  repository: EventsRepository,
  sources: string[],
  logger: Logger,
  { timeoutMs, fetchImpl }: { timeoutMs: number; fetchImpl?: Fetch },
): Promise<SourceHarvestResult[]> => {
  const results: SourceHarvestResult[] = [];
  for (const origin of sources) {
    const sourceName = new URL(origin).host;
    const startedAt = performance.now();
    try {
      const { events, skipped } = await fetchUpcomingEvents(origin, { timeoutMs, fetchImpl });
      const result: SourceHarvestResult = {
        source: sourceName,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        removed: 0,
        skipped,
      };
      for (const event of events) result[await repository.upsertHarvested(sourceName, event)]++;
      // A skipped entity may be a stored event that no longer maps (e.g. a Pleio schema change), so nothing is removed then.
      if (skipped === 0) {
        result.removed = await repository.removeVanished(
          sourceName,
          events.map((event) => event.externalId),
        );
      }
      results.push(result);
      logger.info(
        {
          component: "events",
          operation: "pleio_harvest",
          ...result,
          duration_ms: Math.round(performance.now() - startedAt),
        },
        "pleio harvest completed",
      );
    } catch (error) {
      logger.error(
        {
          component: "events",
          operation: "pleio_harvest",
          source: sourceName,
          duration_ms: Math.round(performance.now() - startedAt),
          error_message: error instanceof Error ? error.message : String(error),
        },
        "pleio harvest failed",
      );
    }
  }
  return results;
};
