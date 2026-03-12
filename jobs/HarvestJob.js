const logger = require("../logger");
const { HarvestService } = require("../services/HarvestService");

const DEFAULT_DAILY_HOUR = 15;
const DEFAULT_DAILY_MINUTE = 30;
const DEFAULT_RUN_TIMEOUT_MS = 5 * 60 * 1000;

const trimString = (value) => (typeof value === "string" ? value.trim() : "");

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
};

const getNextRunAt = (hour, minute, now = new Date()) => {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
};

const sourceLabel = (source) => trimString(source?.name) || trimString(source?.indexUrl) || "unknown-source";

const createAbortControllerWithTimeout = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const cleanup = () => clearTimeout(timeoutId);
  return { controller, cleanup };
};

const scheduleHarvest = (service, sources, options = {}) => {
  const sourceList = Array.isArray(sources)
    ? sources.filter((source) => source && typeof source === "object" && !Array.isArray(source))
    : [];
  if (sourceList.length === 0) {
    logger.warn("[HarvestJob] Geen geldige harvest sources geconfigureerd, scheduler wordt niet gestart.");
    return null;
  }

  const runTimeoutMs = parsePositiveInteger(options.runTimeoutMs, DEFAULT_RUN_TIMEOUT_MS);
  const hour = Number.isInteger(options.hour) ? options.hour : DEFAULT_DAILY_HOUR;
  const minute = Number.isInteger(options.minute) ? options.minute : DEFAULT_DAILY_MINUTE;

  let timer = null;
  let stopped = false;
  let running = false;
  let activeController = null;

  const runSources = async (reason) => {
    if (stopped) {
      return;
    }
    if (running) {
      logger.warn(`[HarvestJob] Run '${reason}' overgeslagen: vorige run draait nog.`);
      return;
    }
    running = true;
    const { controller, cleanup } = createAbortControllerWithTimeout(runTimeoutMs);
    activeController = controller;
    try {
      for (const source of sourceList) {
        const label = sourceLabel(source);
        try {
          const summary = await service.runOnce(source, { signal: controller.signal });
          logger.info(
            `[HarvestJob] Bron '${label}' verwerkt: scanned=${summary.scanned}, posted=${summary.posted}, badRequest=${summary.badRequest}, failed=${summary.failed}`,
          );
        } catch (error) {
          logger.error(`[HarvestJob] Bron '${label}' mislukt: ${error?.message || "onbekende fout"}`);
        }
      }
    } finally {
      cleanup();
      activeController = null;
      running = false;
    }
  };

  const scheduleNext = () => {
    if (stopped) {
      return;
    }
    const nextRunAt = getNextRunAt(hour, minute);
    const delay = Math.max(0, nextRunAt.getTime() - Date.now());
    timer = setTimeout(async () => {
      await runSources("daily");
      scheduleNext();
    }, delay);
    logger.info(`[HarvestJob] Volgende harvest run gepland op ${nextRunAt.toISOString()}.`);
  };

  scheduleNext();
  void runSources("startup");

  return {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (activeController) {
        activeController.abort();
      }
      logger.info("[HarvestJob] Scheduler gestopt.");
    },
    runNow: () => runSources("manual"),
  };
};

const buildPdokSource = () => ({
  name: "pdok",
  indexUrl: "https://api.pdok.nl/index.json",
  organisationUri: "https://www.pdok.nl",
  contact: {
    name: "PDOK Support",
    url: "https://www.pdok.nl/support1",
    email: "support@pdok.nl",
  },
});

const schedulePdokHarvestFromEnv = () => {
  const service = HarvestService.fromEnv();
  if (!service.isConfigured()) {
    logger.info("[HarvestJob] PDOK harvest scheduler niet gestart: PDOK_REGISTER_ENDPOINT ontbreekt.");
    return null;
  }
  if (!service.hasAuthConfig()) {
    logger.warn(
      "[HarvestJob] PDOK harvest scheduler niet gestart: auth mist (AUTH_TOKEN_URL of KEYCLOAK_BASE_URL+KEYCLOAK_REALM, AUTH_CLIENT_ID, AUTH_CLIENT_SECRET).",
    );
    return null;
  }

  const scheduleTime = { hour: DEFAULT_DAILY_HOUR, minute: DEFAULT_DAILY_MINUTE };
  const runTimeoutMs = DEFAULT_RUN_TIMEOUT_MS;
  logger.info(
    `[HarvestJob] PDOK harvest scheduler gestart (dagelijks ${String(scheduleTime.hour).padStart(2, "0")}:${String(
      scheduleTime.minute,
    ).padStart(2, "0")}, directe startup-run).`,
  );
  return scheduleHarvest(service, [buildPdokSource()], {
    hour: scheduleTime.hour,
    minute: scheduleTime.minute,
    runTimeoutMs,
  });
};

module.exports = {
  scheduleHarvest,
  schedulePdokHarvestFromEnv,
  buildPdokSource,
};
