import { readFileSync } from "node:fs";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app/index.ts";

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApp();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

const inject = async (options: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) =>
  app.getHttpAdapter().getInstance().inject(options);

const openApiDocument = {
  openapi: "3.0.3",
  info: { title: "Test API", version: "1.0.0" },
  paths: {},
};

const arazzoDocument = {
  arazzo: "1.0.1",
  info: { title: "Runtime workflow", version: "1.0.0" },
  sourceDescriptions: [{ name: "runtime", url: "https://example.com/openapi.json", type: "openapi" }],
  workflows: [
    {
      workflowId: "ping",
      summary: "Ping workflow",
      steps: [
        {
          stepId: "getPing",
          operationId: "getPing",
          successCriteria: [{ condition: "$statusCode == 200" }],
        },
      ],
    },
  ],
};

describe("app", () => {
  it("serves the OpenAPI spec", async () => {
    const response = await inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { info: { title: string } };
    expect(body.info.title).toBe("Tools API v1");
  });

  it("returns API-Version header", async () => {
    const response = await inject({ method: "GET", url: "/openapi.json" });
    expect(response.headers["api-version"]).toBe("1.0.0");
  });

  it("preserves a valid request id", async () => {
    const response = await inject({
      method: "GET",
      url: "/openapi.json?token=never-log-this",
      headers: { "x-request-id": "request-123" },
    });

    expect(response.headers["x-request-id"]).toBe("request-123");
  });

  it("replaces an unsafe request id", async () => {
    const response = await inject({
      method: "GET",
      url: "/openapi.json",
      headers: { "x-request-id": "unsafe request id" },
    });

    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns problem+json on unknown route", async () => {
    const response = await inject({ method: "GET", url: "/no-such-route?token=never-reflect-this" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 404, title: "Cannot GET /no-such-route" });
    expect(response.body).not.toContain("never-reflect-this");
  });

  it("returns problem+json on validation failure", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/oas/validate",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
  });

  it("renders Arazzo as Markdown through the logic package", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/arazzo/markdown",
      payload: { oasBody: JSON.stringify(arazzoDocument) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/markdown");
    expect(response.body).toContain("Ping workflow");
  });

  it("renders Arazzo as Mermaid through the logic package", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/arazzo/mermaid",
      payload: { oasBody: JSON.stringify(arazzoDocument) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("flowchart TD");
    expect(response.body).toContain("Ping workflow");
  });

  it("converts OpenAPI through the logic package", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/oas/convert",
      payload: {
        oasBody: JSON.stringify(openApiDocument),
        targetVersion: "3.1",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(response.body)).toMatchObject({ openapi: "3.1.0" });
  });

  it("returns a bundled OpenAPI document directly", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/oas/bundle",
      payload: { oasBody: JSON.stringify(openApiDocument) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="openapi.json"');
    expect(JSON.parse(response.body)).toMatchObject(openApiDocument);
  });

  it("creates a Postman collection through the logic package", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/oas/postman",
      payload: { oasBody: JSON.stringify(openApiDocument) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="test-api.json"');
    expect(JSON.parse(response.body)).toMatchObject({
      info: {
        name: "Test API",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
    });
  });

  it("validates the generated Tools contract through the logic package", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/oas/validate",
      payload: {
        oasBody: readFileSync(new URL("../api/openapi.yaml", import.meta.url), "utf8"),
        targetVersion: "2.1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ failures: 0, successes: true, rulesetVersion: "2.1" });
  });

  it("maps a logic package error to problem details", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/auth/clients",
      payload: { email: "" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 400, title: "email ontbreekt of is ongeldig" });
  });

  it("returns generated OpenAPI directly", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/oas/generate",
      payload: {
        oasBody: JSON.stringify({
          title: "Generated API",
          description: "Generated API description",
          contact: { name: "DON", email: "don@example.com", url: "https://developer.overheid.nl" },
          resources: [{ name: "item", plural: "items", readonly: true }],
        }),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="generated-api.json"');
    expect(JSON.parse(response.body)).toMatchObject({
      openapi: "3.0.2",
      info: { title: "Generated API" },
      paths: { "/items": expect.any(Object) },
    });
    expect(JSON.parse(response.body)).not.toHaveProperty("rawBody");
  });
});
