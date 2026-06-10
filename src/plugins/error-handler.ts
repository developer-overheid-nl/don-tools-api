import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { HttpError, statusText, toProblemDetails, type Problem } from "@developer-overheid-nl/don-tools-logic";

interface FastifyValidationEntry {
  instancePath?: string;
  message?: string;
  params?: { missingProperty?: string };
}

interface FastifyErrorLike {
  message?: string;
  statusCode?: number;
  validation?: FastifyValidationEntry[];
}

const ajvEntryToPointer = (entry: FastifyValidationEntry): string => {
  const missing = entry.params?.missingProperty;
  const base = entry.instancePath ?? "";
  if (missing) return `#${base}/${missing}`;
  return `#${base}`;
};

export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((rawError, request, reply) => {
    const instance = request.url;

    if (rawError instanceof HttpError) {
      const problem = toProblemDetails(rawError, instance);
      reply.status(problem.status).type("application/problem+json").send(problem);
      return;
    }

    const error = rawError as FastifyErrorLike;

    if (Array.isArray(error.validation)) {
      const problem: Problem = {
        type: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/400",
        title: statusText(400),
        status: 400,
        detail: error.message ?? "Validation failed",
        instance,
        errors: error.validation.map((entry) => ({
          detail: entry.message ?? "validation failed",
          pointer: ajvEntryToPointer(entry),
        })),
      };
      reply.status(400).type("application/problem+json").send(problem);
      return;
    }

    const status = typeof error.statusCode === "number" && error.statusCode >= 400 ? error.statusCode : 500;
    const problem: Problem = {
      type: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/${status}`,
      title: statusText(status),
      status,
      detail: error.message ?? statusText(status),
      instance,
    };

    if (status >= 500) request.log.error({ err: rawError }, "request failed");
    else request.log.warn({ err: rawError }, "request rejected");

    reply.status(status).type("application/problem+json").send(problem);
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .type("application/problem+json")
      .send({
        type: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/404",
        title: statusText(404),
        status: 404,
        detail: `Route ${request.method} ${request.url} not found`,
        instance: request.url,
      });
  });
});
