const { transports, createLogger, format } = require("winston");
const { getRequestContext } = require("./requestContext");

const addRequestContext = format((info) => {
  const { requestId } = getRequestContext();
  if (requestId && !info.requestId) {
    info.requestId = requestId;
  }
  return info;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(format.errors({ stack: true }), addRequestContext(), format.timestamp(), format.json()),
  defaultMeta: { service: "don-tools-api" },
  transports: [new transports.Console()],
});

module.exports = logger;
