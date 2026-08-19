const http = require("node:http");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const OpenApiValidator = require("express-openapi-validator");
const logger = require("./logger");
const config = require("./config");
const { runWithRequestContext } = require("./requestContext");

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

const resolveRequestId = (value) => {
  const candidate = typeof value === "string" ? value.trim() : "";
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
};

class ExpressServer {
  static sanitizeOperationId(operationId) {
    if (!operationId || typeof operationId !== "string") {
      return null;
    }
    let result = operationId.trim();
    if (result.length === 0) {
      return null;
    }
    result = result.replace(/[_-]+/g, " ");
    result = result.replace(/[^a-zA-Z0-9_$]+/g, " ");
    result = result
      .split(" ")
      .filter((segment) => segment.length > 0)
      .map((segment, index) => {
        if (index === 0) {
          return segment;
        }
        return segment.charAt(0).toUpperCase() + segment.slice(1);
      })
      .join("");
    result = result.replace(/^[^a-zA-Z_$]+/, "");
    if (result.length === 0) {
      return null;
    }
    return result.charAt(0).toLowerCase() + result.slice(1);
  }

  static sanitizeTagName(tagName) {
    if (!tagName || typeof tagName !== "string") {
      return null;
    }
    let result = tagName.trim();
    if (result.length === 0) {
      return null;
    }
    result = result.replace(/[_-]+/g, " ");
    result = result.replace(/[^a-zA-Z0-9_$]+/g, " ");
    const parts = result
      .split(" ")
      .filter((segment) => segment.length > 0)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1));
    if (parts.length === 0) {
      return null;
    }
    return parts.join("");
  }

  static normalizeOperationIds(schema) {
    if (!schema?.paths) {
      return;
    }
    const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
    for (const pathKey of Object.keys(schema.paths)) {
      const pathItem = schema.paths[pathKey];
      for (const method of methods) {
        const operation = pathItem[method];
        if (operation?.operationId) {
          const normalizedId = ExpressServer.sanitizeOperationId(operation.operationId);
          if (normalizedId && normalizedId !== operation.operationId) {
            operation["x-original-operationId"] = operation.operationId;
            operation.operationId = normalizedId;
          }
        }
      }
    }
  }

  constructor(port, openApiJsonPath) {
    this.port = port;
    this.app = express();
    try {
      this.schema = JSON.parse(fs.readFileSync(openApiJsonPath, "utf8"));
      if (this.schema?.components) {
        const { components } = this.schema;
        const componentMirrors = [
          "schemas",
          "responses",
          "parameters",
          "examples",
          "requestBodies",
          "headers",
          "securitySchemes",
          "links",
          "callbacks",
          "pathItems",
        ];
        for (const key of componentMirrors) {
          if (!this.schema[key] && components[key]) {
            this.schema[key] = components[key];
          }
        }
      }
      ExpressServer.normalizeOperationIds(this.schema);
    } catch (e) {
      throw new Error(`Unable to load OpenAPI specification: ${e.message}`, { cause: e });
    }
    this.setupMiddleware();
  }

  static getStatusText(status) {
    const statusTexts = {
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      405: "Method Not Allowed",
      409: "Conflict",
      422: "Unprocessable Entity",
      429: "Too Many Requests",
      500: "Internal Server Error",
      501: "Not Implemented",
      502: "Bad Gateway",
      503: "Service Unavailable",
      504: "Gateway Timeout",
    };
    return statusTexts[status] || "Unknown Error";
  }

  setupMiddleware() {
    // this.setupAllowedMedia();
    this.app.use((req, res, next) => {
      const startedAt = process.hrtime.bigint();
      const requestId = resolveRequestId(req.get("x-request-id"));
      req.requestId = requestId;
      res.set("X-Request-ID", requestId);
      let boundaryLogged = false;
      const logRequestBoundary = (aborted = false) => {
        if (boundaryLogged) {
          return;
        }
        boundaryLogged = true;
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const level = aborted || res.statusCode >= 400 ? (res.statusCode >= 500 ? "error" : "warn") : "info";
        logger.log(level, "HTTP request completed", {
          event: "http.request.completed",
          requestId,
          method: req.method,
          path: req.path,
          operationId: req.openapi?.schema?.["x-original-operationId"] || req.openapi?.schema?.operationId,
          statusCode: res.statusCode,
          durationMs,
          error: res.locals.loggingError,
          ...(aborted ? { aborted: true } : {}),
        });
      };
      res.on("finish", () => logRequestBoundary());
      res.on("close", () => {
        if (!res.writableFinished) {
          logRequestBoundary(true);
        }
      });
      runWithRequestContext({ requestId }, next);
    });
    this.app.use(cors());
    this.app.use(bodyParser.json({ limit: "14MB" }));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: false }));
    this.app.use((_req, res, next) => {
      res.set("API-Version", this.schema.info.version);
      next();
    });
    const sendOpenApiSpec = (_req, res) => res.json(this.schema);
    this.app.get("/v1/openapi.json", sendOpenApiSpec);
    this.app.use(
      OpenApiValidator.middleware({
        apiSpec: this.schema,
        validateApiSpec: false,
        validateSecurity: false,
        validateRequests: {
          coerceTypes: false,
          allowUnknownBodyProperties: false,
        },
        operationHandlers: {
          basePath: path.join(__dirname),
        },
        fileUploader: { dest: config.FILE_UPLOAD_PATH },
      }),
    );
    ExpressServer.registerRoutes(this.app, this.schema);
  }

  static toExpressPath(openApiPath) {
    return openApiPath.replace(/{/g, ":").replace(/}/g, "");
  }

  static resolveOperationHandler(operation) {
    let handlerRef = operation["x-eov-operation-handler"];
    if (!handlerRef && operation.tags?.length > 0) {
      const tagName = ExpressServer.sanitizeTagName(operation.tags[0]);
      if (tagName) {
        handlerRef = `controllers/${tagName}Controller`;
      }
    }
    if (!handlerRef) {
      logger.warn("Route handler reference is missing", {
        event: "route.handler_reference.missing",
        operationId: operation.operationId,
      });
      return null;
    }
    const normalizedRef = handlerRef.replace(/\\/g, "/");
    const modulePath = normalizedRef.endsWith(".js")
      ? path.join(__dirname, normalizedRef)
      : path.join(__dirname, `${normalizedRef}.js`);
    if (!fs.existsSync(modulePath)) {
      logger.warn("Route handler module is missing", {
        event: "route.handler_module.missing",
        operationId: operation.operationId,
        modulePath,
      });
      return null;
    }
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const controllerModule = require(modulePath);
    const handler = controllerModule[operation.operationId];
    if (typeof handler !== "function") {
      logger.warn("Route handler function is missing", {
        event: "route.handler_function.missing",
        operationId: operation.operationId,
        modulePath,
      });
      return null;
    }
    return handler;
  }

  static registerRoutes(app, schema) {
    if (!schema?.paths) {
      return;
    }
    const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
    for (const pathKey of Object.keys(schema.paths)) {
      const expressPath = ExpressServer.toExpressPath(pathKey);
      const pathItem = schema.paths[pathKey];
      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation) {
          continue;
        }
        const handler = ExpressServer.resolveOperationHandler(operation);
        if (!handler) {
          continue;
        }
        app[method](expressPath, async (req, res, next) => {
          req.openapi = req.openapi || {};
          req.openapi.schema = req.openapi.schema || operation;
          req.openapi.pathParams = req.openapi.pathParams || req.params;
          try {
            await Promise.resolve(handler(req, res, next));
          } catch (error) {
            next(error);
          }
        });
      }
    }
  }

  async launch() {
    // eslint-disable-next-line no-unused-vars
    this.app.use((err, req, res, _next) => {
      // format errors using RFC 7807 Problem Details format
      const status = err.status || 500;
      const problemDetails = {
        type: `https://httpstatuses.com/${status}`,
        title: ExpressServer.getStatusText(status),
        status,
        detail: err.message || err.toString(),
      };

      // Add instance URI if available
      if (req.originalUrl) {
        problemDetails.instance = req.originalUrl;
      }

      // Add additional error details if available
      if (err.status === 400 && err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
        problemDetails.invalidParams = err.errors;
      }

      res.locals.loggingError = {
        message: problemDetails.detail,
        ...(status >= 500 ? { detail: problemDetails.detail } : {}),
        ...(status >= 500 && err.stack ? { stack: err.stack } : {}),
      };

      // Set the proper content type for problem+json
      res.set("Content-Type", "application/problem+json");
      res.status(status).json(problemDetails);
    });

    this.server = http.createServer(this.app);
    this.connections = new Set();
    this.server.on("connection", (socket) => {
      this.connections.add(socket);
      socket.once("close", () => this.connections.delete(socket));
    });
    await new Promise((resolve, reject) => {
      const handleStartupError = (error) => {
        this.server = undefined;
        reject(error);
      };
      this.server.once("error", handleStartupError);
      this.server.listen(this.port, () => {
        this.server.off("error", handleStartupError);
        resolve();
      });
    });
    const address = this.server.address();
    this.listeningPort = typeof address === "object" && address ? address.port : this.port;
    logger.info("HTTP server started", {
      event: "server.started",
      port: this.listeningPort,
    });
    return this.server;
  }

  async close({ signal } = {}) {
    if (this.closePromise) {
      return this.closePromise;
    }
    if (this.server === undefined) {
      return undefined;
    }
    const server = this.server;
    const gracePeriodMs = config.SHUTDOWN_GRACE_PERIOD_MS;
    this.closePromise = (async () => {
      let stopped = false;
      const forceTimer = setTimeout(() => {
        if (stopped) {
          return;
        }
        logger.warn("HTTP server is force-closing connections after the shutdown grace period", {
          event: "server.shutdown.force_close",
          ...(signal ? { signal } : {}),
          gracePeriodMs,
          connectionCount: this.connections?.size || 0,
        });
        server.closeAllConnections?.();
        for (const socket of this.connections || []) {
          socket.destroy();
        }
      }, gracePeriodMs);
      forceTimer.unref();

      try {
        const serverClosed = new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        server.closeIdleConnections?.();
        await serverClosed;
        stopped = true;
      } finally {
        clearTimeout(forceTimer);
      }
      this.server = undefined;
      logger.info("HTTP server stopped", {
        event: "server.stopped",
        port: this.listeningPort,
      });
    })();
    try {
      await this.closePromise;
    } finally {
      this.closePromise = undefined;
    }
    return undefined;
  }
}

module.exports = ExpressServer;
