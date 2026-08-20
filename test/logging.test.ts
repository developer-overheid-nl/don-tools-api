import { get } from "node:http";
import { Readable, Writable } from "node:stream";
import fastify from "fastify";
import pino, { type LoggerOptions } from "pino";
import { describe, expect, it } from "vitest";
import { createFastifyOptions, NestPinoLogger, registerRequestLogging } from "../app/logging.ts";

const captureLogs = () => {
  let output = "";
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  return {
    destination,
    records: () =>
      output
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
};

const expectFixedFields = (record: Record<string, unknown>) => {
  expect(record.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(["DEBUG", "INFO", "WARN", "ERROR"]).toContain(record.level);
  expect(record).toMatchObject({ app: "tools-api" });
  expect(record.msg).toEqual(expect.any(String));
  expect(record.component).toEqual(expect.any(String));
  expect(record.operation).toEqual(expect.any(String));
};

describe("logging", () => {
  it("rejects log levels outside the shared contract", () => {
    const configuredLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "trace";
    try {
      expect(() => createFastifyOptions()).toThrow(/LOG_LEVEL/);
    } finally {
      if (configuredLevel === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = configuredLevel;
    }
  });

  it("writes the shared application log contract", () => {
    const capture = captureLogs();
    const options = createFastifyOptions();
    const logger = pino(options.logger as LoggerOptions, capture.destination);

    logger.info(
      { component: "http_server", operation: "listen", address: ":1337" },
      "server started",
    );

    const [record] = capture.records();
    expectFixedFields(record);
    expect(record).toMatchObject({
      level: "INFO",
      msg: "server started",
      app: "tools-api",
      component: "http_server",
      operation: "listen",
      address: ":1337",
    });
    expect(record).not.toHaveProperty("service");
    expect(record).not.toHaveProperty("version");
    expect(record).not.toHaveProperty("environment");
    expect(record).not.toHaveProperty("event");
  });

  it("normalizes direct Pino trace and fatal calls to the shared levels", () => {
    const capture = captureLogs();
    const options = createFastifyOptions();
    const logger = pino({ ...(options.logger as LoggerOptions), level: "trace" }, capture.destination);

    logger.trace({ component: "application", operation: "log" }, "trace message");
    logger.fatal({ component: "application", operation: "log" }, "fatal message");

    const [trace, fatal] = capture.records();
    expectFixedFields(trace);
    expect(trace).toMatchObject({ level: "DEBUG", msg: "trace message" });
    expectFixedFields(fatal);
    expect(fatal).toMatchObject({ level: "ERROR", msg: "fatal message" });
  });

  it("adapts Nest messages to the shared application log contract", () => {
    const capture = captureLogs();
    const options = createFastifyOptions();
    const logger = new NestPinoLogger(
      pino({ ...(options.logger as LoggerOptions), level: "debug" }, capture.destination),
    );

    logger.verbose("route registered", "RouterExplorer");
    logger.fatal(new Error("private failure"), "NestApplication");

    const [verbose, fatal] = capture.records();
    expectFixedFields(verbose);
    expect(verbose).toMatchObject({
      level: "DEBUG",
      msg: "route registered",
      component: "application",
      operation: "log",
      context: "RouterExplorer",
    });
    expectFixedFields(fatal);
    expect(fatal).toMatchObject({
      level: "ERROR",
      msg: "Error",
      component: "application",
      operation: "log",
      context: "NestApplication",
    });
    expect(JSON.stringify(fatal)).not.toContain("private failure");
  });

  it("writes one snake-case access log and only treats 5xx as an error", async () => {
    const capture = captureLogs();
    const options = createFastifyOptions();
    const app = fastify({
      ...options,
      logger: { ...(options.logger as LoggerOptions), stream: capture.destination },
    });
    registerRequestLogging(app);
    app.addHook("onSend", async (request, _reply, payload) =>
      request.url.startsWith("/rewritten") ? "rewritten-response" : payload,
    );
    app.get("/items/:id", async () => ({ ok: true }));
    app.get("/client-error", async (_request, reply) => reply.status(404).send({ error: "missing" }));
    app.get("/server-error", async (_request, reply) => reply.status(503).send({ error: "failure" }));
    app.get("/rewritten", async () => "x");
    app.get("/stream", async () => Readable.from(["stream-body"]));

    await app.inject({
      method: "GET",
      url: "/items/123?token=secret",
      headers: { "x-request-id": "ok-123" },
    });
    await app.inject({ method: "GET", url: "/client-error", headers: { "x-request-id": "client-123" } });
    await app.inject({ method: "GET", url: "/server-error", headers: { "x-request-id": "server-123" } });
    const rewritten = await app.inject({
      method: "GET",
      url: "/rewritten",
      headers: { "x-request-id": "rewritten-123" },
    });
    const streamed = await app.inject({
      method: "GET",
      url: "/stream",
      headers: { "x-request-id": "stream-123" },
    });
    await app.close();

    const records = capture.records();
    expect(rewritten.body).toBe("rewritten-response");
    expect(streamed.body).toBe("stream-body");
    expect(records).toHaveLength(5);
    for (const record of records) expectFixedFields(record);
    expect(
      records.map(
        ({ level, msg, request_id, method, route, path, status_code, response_bytes }) => ({
          level,
          msg,
          request_id,
          method,
          route,
          path,
          status_code,
          response_bytes,
        }),
      ),
    ).toEqual([
      {
        level: "INFO",
        msg: "HTTP request completed",
        request_id: "ok-123",
        method: "GET",
        route: "/items/:id",
        path: "/items/123",
        status_code: 200,
        response_bytes: 11,
      },
      {
        level: "INFO",
        msg: "HTTP request completed",
        request_id: "client-123",
        method: "GET",
        route: "/client-error",
        path: "/client-error",
        status_code: 404,
        response_bytes: 19,
      },
      {
        level: "ERROR",
        msg: "HTTP request completed",
        request_id: "server-123",
        method: "GET",
        route: "/server-error",
        path: "/server-error",
        status_code: 503,
        response_bytes: 19,
      },
      {
        level: "INFO",
        msg: "HTTP request completed",
        request_id: "rewritten-123",
        method: "GET",
        route: "/rewritten",
        path: "/rewritten",
        status_code: 200,
        response_bytes: 18,
      },
      {
        level: "INFO",
        msg: "HTTP request completed",
        request_id: "stream-123",
        method: "GET",
        route: "/stream",
        path: "/stream",
        status_code: 200,
        response_bytes: 11,
      },
    ]);
    for (const record of records) {
      expect(record.duration_ms).toEqual(expect.any(Number));
      expect(Number.isInteger(record.duration_ms)).toBe(true);
      expect(record).not.toHaveProperty("reqId");
      expect(record).not.toHaveProperty("requestId");
      expect(record).not.toHaveProperty("statusCode");
      expect(record).not.toHaveProperty("durationMs");
      expect(record).not.toHaveProperty("event");
    }
    expect(JSON.stringify(records)).not.toContain("secret");
  });

  it("destroys the response source when a streaming client disconnects", async () => {
    const options = createFastifyOptions();
    const app = fastify(options);
    registerRequestLogging(app);
    let sent = false;
    const source = new Readable({
      read() {
        if (!sent) {
          sent = true;
          this.push("stream-chunk");
        }
      },
    });
    app.get("/disconnect", async () => source);

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");

    try {
      await new Promise<void>((resolve, reject) => {
        const request = get({ host: "127.0.0.1", port: address.port, path: "/disconnect" }, (response) => {
          response.once("data", () => response.destroy());
          response.once("close", resolve);
        });
        request.once("error", reject);
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(source.destroyed).toBe(true);
    } finally {
      source.destroy();
      await app.close();
    }
  });
});
