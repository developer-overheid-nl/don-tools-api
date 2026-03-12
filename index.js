const fs = require("node:fs");
const path = require("node:path");

const loadLocalEnvFile = () => {
  if (typeof process.loadEnvFile !== "function") {
    return;
  }
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  process.loadEnvFile(envPath);
};

loadLocalEnvFile();

const config = require("./config");
const logger = require("./logger");
const ExpressServer = require("./expressServer");
const { schedulePdokHarvestFromEnv } = require("./jobs/HarvestJob");

let expressServer;
let harvestScheduler;

const launchServer = async () => {
  try {
    expressServer = new ExpressServer(config.URL_PORT, config.OPENAPI_JSON);
    expressServer.launch();
    harvestScheduler = schedulePdokHarvestFromEnv();
    logger.info("Express server running");
  } catch (error) {
    logger.error("Express Server failure", error.message);
    if (harvestScheduler && typeof harvestScheduler.stop === "function") {
      harvestScheduler.stop();
    }
    await expressServer?.close?.();
  }
};

launchServer().catch((e) => logger.error(e));
