import { Writable } from "node:stream";
import pino, { type LoggerOptions } from "pino";
import { describe, expect, it } from "vitest";
import { createFastifyOptions } from "../app/logging.ts";

describe("logging", () => {
  it("identifies every record as the tools API application", () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const options = createFastifyOptions();
    const logger = pino(options.logger as LoggerOptions, destination);

    logger.info({ event: "test" });

    const record = JSON.parse(output) as Record<string, unknown>;
    expect(record).toMatchObject({ app: "tools-api", event: "test" });
    expect(record).not.toHaveProperty("service");
  });
});
