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

const launchServer = async () => {
  try {
    this.expressServer = new ExpressServer(config.URL_PORT, config.OPENAPI_JSON);
    this.expressServer.launch();
    this.harvestScheduler = schedulePdokHarvestFromEnv();
    logger.info("Express server running");
  } catch (error) {
    logger.error("Express Server failure", error.message);
    if (this.harvestScheduler && typeof this.harvestScheduler.stop === "function") {
      this.harvestScheduler.stop();
    }
    await this.close();
  }
};

launchServer().catch((e) => logger.error(e));
