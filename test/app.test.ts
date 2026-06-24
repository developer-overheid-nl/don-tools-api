import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApp } from "../app/index.ts";

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApp();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

const inject = async (options: { method: string; url: string; payload?: unknown }) =>
  app.getHttpAdapter().getInstance().inject(options);

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

  it("returns problem+json on unknown route", async () => {
    const response = await inject({ method: "GET", url: "/no-such-route" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 404, title: "Cannot GET /no-such-route" });
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

  it("converts OpenAPI through the logic package", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/oas/convert",
      payload: {
        oasBody: JSON.stringify({ openapi: "3.0.3", info: { title: "T", version: "1.0.0" }, paths: {} }),
        targetVersion: "3.1",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(response.body)).toMatchObject({ openapi: "3.1.0" });
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
