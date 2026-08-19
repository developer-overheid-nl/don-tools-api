const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const test = require("node:test");

const loggerPath = path.resolve(__dirname, "../logger.js");
const expressServerPath = path.resolve(__dirname, "../expressServer.js");
const openApiPath = path.resolve(__dirname, "../api/openapi.json");
const configPath = path.resolve(__dirname, "../config.js");
const indexPath = path.resolve(__dirname, "../index.js");

test("development logging emits one structured stdout record without creating local log files", (t) => {
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "don-tools-api-logger-"));
  t.after(() => fs.rmSync(workingDirectory, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `const logger = require(${JSON.stringify(loggerPath)}); logger.info("probe", { operation: "test" }); logger.end();`,
    ],
    {
      cwd: workingDirectory,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "development" },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const outputLines = result.stdout.trim().split("\n");
  assert.equal(outputLines.length, 1);
  assert.deepEqual(JSON.parse(outputLines[0]), {
    level: "info",
    message: "probe",
    operation: "test",
    service: "don-tools-api",
    timestamp: JSON.parse(outputLines[0]).timestamp,
  });
  assert.deepEqual(fs.readdirSync(workingDirectory), []);
});

test("LOG_LEVEL filters records below the configured severity", (t) => {
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "don-tools-api-log-level-"));
  t.after(() => fs.rmSync(workingDirectory, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `const logger = require(${JSON.stringify(loggerPath)}); logger.info("hidden"); logger.error("visible"); logger.end();`,
    ],
    {
      cwd: workingDirectory,
      encoding: "utf8",
      env: { ...process.env, LOG_LEVEL: "error" },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const outputLines = result.stdout.trim().split("\n");
  assert.equal(outputLines.length, 1);
  assert.equal(JSON.parse(outputLines[0]).message, "visible");
});

test("Error objects retain their message and stack in structured output", (t) => {
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "don-tools-api-log-error-"));
  t.after(() => fs.rmSync(workingDirectory, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    ["-e", `const logger = require(${JSON.stringify(loggerPath)}); logger.error(new Error("boom")); logger.end();`],
    {
      cwd: workingDirectory,
      encoding: "utf8",
      env: process.env,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout.trim());
  assert.equal(record.message, "boom");
  assert.match(record.stack, /^Error: boom/);
});

test("server startup and shutdown emit structured lifecycle records and release the listener", (t) => {
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "don-tools-api-lifecycle-"));
  t.after(() => fs.rmSync(workingDirectory, { recursive: true, force: true }));

  const script = `
    const ExpressServer = require(${JSON.stringify(expressServerPath)});
    const logger = require(${JSON.stringify(loggerPath)});
    const timeout = setTimeout(() => process.exit(2), 2000);
    (async () => {
      const server = new ExpressServer(0, ${JSON.stringify(openApiPath)});
      await server.launch();
      await server.close();
      clearTimeout(timeout);
      logger.end();
    })();
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: workingDirectory,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
    timeout: 3000,
  });

  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const records = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map(({ event, level, message }) => ({ event, level, message })),
    [
      { event: "server.started", level: "info", message: "HTTP server started" },
      { event: "server.stopped", level: "info", message: "HTTP server stopped" },
    ],
  );
});

test("application startup and SIGTERM emit one structured lifecycle record each", async () => {
  const script = `
    const config = require(${JSON.stringify(configPath)});
    config.URL_PORT = 0;
    require(${JSON.stringify(indexPath)});
  `;
  const child = spawn(process.execPath, ["-e", script], {
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`application did not start in time: ${stderr}`));
    }, 3000);
    const waitForStartup = setInterval(() => {
      if (stdout.includes('"event":"server.started"')) {
        clearInterval(waitForStartup);
        setTimeout(() => child.kill("SIGTERM"), 100);
      }
    }, 10);
    child.on("exit", () => {
      clearTimeout(timeout);
      clearInterval(waitForStartup);
      resolve();
    });
    child.on("error", reject);
  });

  const records = stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(records.map(({ event, message }) => ({ event, message })), [
    { event: "server.started", message: "HTTP server started" },
    { event: "server.stopped", message: "HTTP server stopped" },
  ]);
});

test("SIGTERM bounds shutdown when a connection does not drain", async (t) => {
  const script = `
    const config = require(${JSON.stringify(configPath)});
    config.URL_PORT = 0;
    require(${JSON.stringify(indexPath)});
  `;
  const child = spawn(process.execPath, ["-e", script], {
    env: { ...process.env, NODE_ENV: "production", SHUTDOWN_GRACE_PERIOD_MS: "50" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const startedRecord = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`application did not start in time: ${stderr}`)), 3000);
    const poll = setInterval(() => {
      const record = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .find(({ event }) => event === "server.started");
      if (record) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve(record);
      }
    }, 10);
  });

  const socket = net.createConnection({ host: "127.0.0.1", port: startedRecord.port });
  t.after(() => socket.destroy());
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write("GET /v1/openapi.json HTTP/1.1\r\nHost: 127.0.0.1\r\n");

  const shutdownStartedAt = Date.now();
  child.kill("SIGTERM");
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`application did not stop in time: ${stderr}`)), 1500);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.once("error", reject);
  });

  assert.ok(Date.now() - shutdownStartedAt < 1500);
  const records = stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map(({ event, level }) => ({ event, level })),
    [
      { event: "server.started", level: "info" },
      { event: "server.shutdown.force_close", level: "warn" },
      { event: "server.stopped", level: "info" },
    ],
  );
});

test("application startup failure emits one structured error and exits unsuccessfully", () => {
  const script = `
    const config = require(${JSON.stringify(configPath)});
    config.URL_PORT = 0;
    config.OPENAPI_JSON = "/definitely/missing/openapi.json";
    require(${JSON.stringify(indexPath)});
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
    timeout: 3000,
  });

  assert.equal(result.status, 1, result.error?.message || result.stderr);
  const records = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "server.startup.failed");
  assert.equal(records[0].level, "error");
  assert.equal(records[0].message, "HTTP server failed to start");
  assert.match(records[0].error.message, /OpenAPI specification/);
  assert.match(records[0].error.stack, /^Error: Unable to load OpenAPI specification/);
});
