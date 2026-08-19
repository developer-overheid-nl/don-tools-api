const { transports, createLogger, format } = require("winston");

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(format.errors({ stack: true }), format.timestamp(), format.json()),
  defaultMeta: { service: "don-tools-api" },
  transports: [new transports.Console()],
});

module.exports = logger;
