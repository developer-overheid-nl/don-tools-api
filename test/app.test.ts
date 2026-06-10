import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ loggerEnabled: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("app", () => {
  it("serves the OpenAPI spec", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { info: { title: string } };
    expect(body.info.title).toBe("Tools API v1");
  });

  it("returns API-Version header", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(response.headers["api-version"]).toBe("1.0.0");
  });

  it("returns problem+json on unknown route", async () => {
    const response = await app.inject({ method: "GET", url: "/no-such-route" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 404, title: "Not Found" });
  });

  it("returns problem+json on validation failure", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/oas/validate",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
  });

  it("converts OpenAPI through the logic package", async () => {
    const response = await app.inject({
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
});
