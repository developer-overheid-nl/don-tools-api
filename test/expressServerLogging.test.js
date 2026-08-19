const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { Writable } = require("node:stream");
const test = require("node:test");
const { transports } = require("winston");
const config = require("../config");
const ExpressServer = require("../expressServer");
const logger = require("../logger");
const Service = require("../services/Service");

const openApiPath = path.resolve(__dirname, "../api/openapi.json");

const captureLogRecords = () => {
  const records = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString("utf8").trim().split("\n")) {
        if (line) {
          records.push(JSON.parse(line));
        }
      }
      callback();
    },
  });
  logger.clear();
  logger.add(new transports.Stream({ stream }));
  return records;
};

const listen = (app) =>
  new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });

const close = (server) => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for asynchronous test condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("a completed request emits one correlated structured record", async (t) => {
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/openapi.json`, {
    headers: { "x-request-id": "request-123" },
  });
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), "request-123");
  assert.equal(records.length, 1);
  assert.deepEqual(
    {
      event: records[0].event,
      level: records[0].level,
      message: records[0].message,
      method: records[0].method,
      path: records[0].path,
      requestId: records[0].requestId,
      statusCode: records[0].statusCode,
    },
    {
      event: "http.request.completed",
      level: "info",
      message: "HTTP request completed",
      method: "GET",
      path: "/v1/openapi.json",
      requestId: "request-123",
      statusCode: 200,
    },
  );
  assert.equal(typeof records[0].durationMs, "number");
  assert.ok(records[0].durationMs >= 0);
});

test("an aborted request emits one correlated structured boundary record", async (t) => {
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  let markRequestStarted;
  const requestStarted = new Promise((resolve) => {
    markRequestStarted = resolve;
  });
  expressServer.app.get("/test/never-finishes", (_request, _response) => markRequestStarted());
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const { port } = server.address();
  const request = http.request({
    host: "127.0.0.1",
    port,
    path: "/test/never-finishes?token=must-not-be-logged",
    headers: { "x-request-id": "aborted-request" },
  });
  request.on("error", () => {});
  request.end();
  await requestStarted;
  const requestClosed = new Promise((resolve) => request.once("close", resolve));
  request.destroy();
  await requestClosed;
  await waitFor(() => records.length === 1);

  assert.equal(records.length, 1);
  assert.deepEqual(
    {
      aborted: records[0].aborted,
      event: records[0].event,
      level: records[0].level,
      method: records[0].method,
      path: records[0].path,
      requestId: records[0].requestId,
    },
    {
      aborted: true,
      event: "http.request.completed",
      level: "warn",
      method: "GET",
      path: "/test/never-finishes",
      requestId: "aborted-request",
    },
  );
  assert.doesNotMatch(JSON.stringify(records), /must-not-be-logged/);
});

test("unsafe request identifiers are replaced before they are reflected or logged", async (t) => {
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/openapi.json`, {
    headers: { "x-request-id": "contains sensitive value" },
  });
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));

  const requestId = response.headers.get("x-request-id");
  assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(records[0].requestId, requestId);
  assert.doesNotMatch(JSON.stringify(records), /contains sensitive value/);
});

test("request severity follows the HTTP status family", async (t) => {
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  expressServer.app.get("/test/server-error", (_request, response) => response.status(500).end());
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const { port } = server.address();
  await fetch(`http://127.0.0.1:${port}/missing`).then((response) => response.arrayBuffer());
  await fetch(`http://127.0.0.1:${port}/test/server-error`).then((response) => response.arrayBuffer());
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    records.map(({ level, statusCode }) => ({ level, statusCode })),
    [
      { level: "warn", statusCode: 404 },
      { level: "error", statusCode: 500 },
    ],
  );
});

test("a handled request failure is logged once at the HTTP boundary", async (t) => {
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/oas/convert`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "failed-request",
    },
    body: JSON.stringify({ oasBody: "" }),
  });
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.status, 400);
  assert.equal(records.length, 1);
  assert.deepEqual(
    {
      event: records[0].event,
      error: records[0].error,
      level: records[0].level,
      operationId: records[0].operationId,
      requestId: records[0].requestId,
      statusCode: records[0].statusCode,
    },
    {
      event: "http.request.completed",
      error: {
        message: "Geef een oasBody of oasUrl mee.",
      },
      level: "warn",
      operationId: "ConvertOAS",
      requestId: "failed-request",
      statusCode: 400,
    },
  );
});

test("a service exception is not logged again while propagating to the HTTP boundary", async (t) => {
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/oas/convert`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "service-failure",
    },
    body: JSON.stringify({ oasBody: "{" }),
  });
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.status, 500);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "http.request.completed");
  assert.equal(records[0].level, "error");
  assert.equal(records[0].requestId, "service-failure");
  assert.match(records[0].error.message, /OpenAPI specificatie niet parseren/);
  assert.match(records[0].error.stack, /^Error: Kan OpenAPI specificatie niet parseren/);
});

test("middleware failures add structured error context to the request record", async (t) => {
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  await expressServer.launch();
  t.after(() => expressServer.close());

  const response = await fetch(`http://127.0.0.1:${expressServer.listeningPort}/v1/oas/convert`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "middleware-failure",
    },
    body: "{",
  });
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.status, 400);
  const requestRecord = records.find(({ event }) => event === "http.request.completed");
  assert.equal(requestRecord.requestId, "middleware-failure");
  assert.equal(requestRecord.level, "warn");
  assert.equal(typeof requestRecord.error.message, "string");
  assert.ok(requestRecord.error.message.length > 0);
  assert.deepEqual(Object.keys(requestRecord.error), ["message"]);
});

test("remote fetch retries are correlated without logging URL secrets or response bodies", async (t) => {
  const upstream = http.createServer((_request, response) => {
    response.writeHead(502, { "content-type": "text/plain" });
    response.end("sensitive upstream response");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => close(upstream));

  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const upstreamPort = upstream.address().port;
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/oas/convert`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "remote-fetch-request",
    },
    body: JSON.stringify({
      oasUrl: `http://127.0.0.1:${upstreamPort}/path-secret-value/spec?token=query-secret-value`,
    }),
  });
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.status, 400);
  const retryRecords = records.filter(({ event }) => event === "remote_specification.fetch_attempt.failed");
  assert.equal(retryRecords.length, 2);
  assert.deepEqual(
    retryRecords.map(({ level, requestId, target, withOriginHeader }) => ({
      level,
      requestId,
      target,
      withOriginHeader,
    })),
    [
      {
        level: "warn",
        requestId: "remote-fetch-request",
        target: { origin: `http://127.0.0.1:${upstreamPort}`, resourceType: "openapi_specification" },
        withOriginHeader: true,
      },
      {
        level: "warn",
        requestId: "remote-fetch-request",
        target: { origin: `http://127.0.0.1:${upstreamPort}`, resourceType: "openapi_specification" },
        withOriginHeader: false,
      },
    ],
  );
  const serializedRecords = JSON.stringify(records);
  assert.doesNotMatch(serializedRecords, /path-secret-value/);
  assert.doesNotMatch(serializedRecords, /query-secret-value/);
  assert.doesNotMatch(serializedRecords, /sensitive upstream response/);
});

test("generator validation failures are logged only at the HTTP boundary", async (t) => {
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/oas/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ oasBody: "{" }),
  });
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.status, 400);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "http.request.completed");
  assert.equal(records[0].operationId, "GenerateOAS");
});

test("validator input failures are logged only at the HTTP boundary", async (t) => {
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/oas/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ oasUrl: "not-a-url" }),
  });
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.status, 400);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "http.request.completed");
  assert.equal(records[0].operationId, "validatorOpenAPIPost");
});

test("bundle failures are logged only at the HTTP boundary", async (t) => {
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/oas/bundle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ oasBody: "{" }),
  });
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.status, 400);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "http.request.completed");
  assert.equal(records[0].operationId, "bundleOAS");
});

test("Arazzo conversion failures are logged only at the HTTP boundary", async (t) => {
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/arazzo/markdown`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ oasBody: "{" }),
  });
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.status, 400);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "http.request.completed");
  assert.equal(records[0].operationId, "arazzoMarkdown");
});

test("mock response decisions include structured service and operation context", async (t) => {
  const previousUseMocks = config.USE_MOCKS;
  const previousMockModules = Service.mockModules;
  const previousApiDoc = Service.apiDoc;
  const previousOperationIndex = Service.operationIndex;
  t.after(() => {
    config.USE_MOCKS = previousUseMocks;
    Service.mockModules = previousMockModules;
    Service.apiDoc = previousApiDoc;
    Service.operationIndex = previousOperationIndex;
  });

  config.USE_MOCKS = true;
  Service.mockModules = {};
  Service.apiDoc = undefined;
  Service.operationIndex = undefined;
  const records = captureLogRecords();

  const result = await Service.applyMock("ToolsService", "convertOAS", {});

  assert.equal(result.action, "resolve");
  assert.equal(records.length, 1);
  assert.deepEqual(
    {
      event: records[0].event,
      level: records[0].level,
      message: records[0].message,
      mockService: records[0].mockService,
      operationId: records[0].operationId,
    },
    {
      event: "mock.response.autogenerated",
      level: "info",
      message: "Using autogenerated mock response",
      mockService: "ToolsService",
      operationId: "convertOAS",
    },
  );
});

test("request-scoped mock decisions carry the boundary request identifier", async (t) => {
  const previousUseMocks = config.USE_MOCKS;
  const previousMockModules = Service.mockModules;
  const previousApiDoc = Service.apiDoc;
  const previousOperationIndex = Service.operationIndex;
  t.after(() => {
    config.USE_MOCKS = previousUseMocks;
    Service.mockModules = previousMockModules;
    Service.apiDoc = previousApiDoc;
    Service.operationIndex = previousOperationIndex;
  });

  config.USE_MOCKS = true;
  Service.mockModules = {};
  Service.apiDoc = undefined;
  Service.operationIndex = undefined;
  const records = captureLogRecords();
  const expressServer = new ExpressServer(0, openApiPath);
  const server = await listen(expressServer.app);
  t.after(() => close(server));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/oas/convert`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "mock-request",
    },
    body: JSON.stringify({ oasBody: "{}" }),
  });
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.status, 200);
  const mockRecord = records.find(({ event }) => event.startsWith("mock.response."));
  const requestRecord = records.find(({ event }) => event === "http.request.completed");
  assert.equal(mockRecord.requestId, "mock-request");
  assert.equal(requestRecord.requestId, "mock-request");
});

test("missing route handler configuration emits structured operation context", () => {
  const records = captureLogRecords();

  const handler = ExpressServer.resolveOperationHandler({ operationId: "missingOperation" });

  assert.equal(handler, null);
  assert.equal(records.length, 1);
  assert.deepEqual(
    {
      event: records[0].event,
      level: records[0].level,
      message: records[0].message,
      operationId: records[0].operationId,
    },
    {
      event: "route.handler_reference.missing",
      level: "warn",
      message: "Route handler reference is missing",
      operationId: "missingOperation",
    },
  );
});
