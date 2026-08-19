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

let expressServer;

const launchServer = async () => {
  expressServer = new ExpressServer(config.URL_PORT, config.OPENAPI_JSON);
  await expressServer.launch();
};

const serializeError = (error) => ({
  message: error?.message || String(error),
  ...(error?.stack ? { stack: error.stack } : {}),
});

let shutdownPromise;
const shutdownServer = (signal) => {
  if (!shutdownPromise) {
    shutdownPromise = expressServer?.close?.({ signal }).catch((error) => {
      logger.error("HTTP server failed to stop", {
        event: "server.shutdown.failed",
        signal,
        error: serializeError(error),
      });
      process.exitCode = 1;
    });
  }
  return shutdownPromise;
};

process.once("SIGTERM", () => shutdownServer("SIGTERM"));
process.once("SIGINT", () => shutdownServer("SIGINT"));

launchServer().catch(async (error) => {
  let shutdownError;
  try {
    await expressServer?.close?.();
  } catch (closeError) {
    shutdownError = serializeError(closeError);
  }
  logger.error("HTTP server failed to start", {
    event: "server.startup.failed",
    error: serializeError(error),
    ...(shutdownError ? { shutdownError } : {}),
  });
  process.exitCode = 1;
});
