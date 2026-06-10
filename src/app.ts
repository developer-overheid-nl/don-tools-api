import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import addFormats from "ajv-formats";
import openapiGlue from "fastify-openapi-glue";
import { config } from "./config.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { Routes } from "./routes.js";
import { toLowerCamelCase } from "./utils/operation-id.js";

export interface BuildOptions {
  loggerEnabled?: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, "..");
const openapiSpecPath = join(rootDir, "api", "openapi.json");

export const buildApp = async (options: BuildOptions = {}): Promise<FastifyInstance> => {
  const app = Fastify({
    logger:
      options.loggerEnabled === false
        ? false
        : {
            level: config.logLevel,
            transport:
              config.nodeEnv === "production"
                ? undefined
                : {
                    target: "pino-pretty",
                    options: { translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
                  },
          },
    bodyLimit: 14 * 1024 * 1024,
    ajv: {
      customOptions: { strict: false, allErrors: true },
      // biome-ignore lint/suspicious/noExplicitAny: ajv-formats default-export typing
      plugins: [[(addFormats as any).default ?? addFormats, { mode: "fast" }]],
    },
  });

  const specRaw = await readFile(openapiSpecPath, "utf8");
  const spec = JSON.parse(specRaw) as { info: { version: string } };
  const apiVersion = spec.info.version;

  app.addContentTypeParser(["text/markdown", "text/plain"], { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  app.addHook("onSend", async (_request, reply) => {
    if (!reply.getHeader("API-Version")) reply.header("API-Version", apiVersion);
  });

  await app.register(cors);
  await app.register(errorHandlerPlugin);

  app.get("/v1/openapi.json", async () => spec);

  const handlers = new Routes() as unknown as Record<string, unknown>;

  await app.register(openapiGlue, {
    specification: spec,
    operationResolver: ((operationId: string) => {
      const handler = handlers[toLowerCamelCase(operationId)];
      return typeof handler === "function" ? handler : undefined;
    }) as unknown as NonNullable<Parameters<typeof openapiGlue>[1]>["operationResolver"],
    prefix: "",
  });

  return app;
};
