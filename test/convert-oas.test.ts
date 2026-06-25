import { describe, expect, it } from "vitest";
import { load } from "js-yaml";
import { convertOAS } from "@developer-overheid-nl/don-tools-logic";

const toJson = (buffer: Buffer) => JSON.parse(buffer.toString("utf8"));
const toYaml = (buffer: Buffer) => load(buffer.toString("utf8")) as Record<string, unknown>;

describe("convertOAS", () => {
  it("upgrades 3.0 -> 3.1 (JSON)", async () => {
    const sourceSpec = {
      openapi: "3.0.3",
      info: { title: "Test API", version: "1.0.0" },
      paths: {},
      "x-webhooks": { onEvent: { post: { responses: { 200: { description: "OK" } } } } },
      components: {
        schemas: { Pet: { type: "object", properties: { nickname: { type: "string", nullable: true } } } },
      },
    };

    const result = await convertOAS({ oasBody: JSON.stringify(sourceSpec), targetVersion: "3.1" });
    const converted = toJson(result.rawBody);

    expect(result.headers["Content-Type"]).toBe("application/json");
    expect(result.headers["Content-Disposition"]).toBe('attachment; filename="openapi-3-1-0.json"');
    expect(converted.openapi).toBe("3.1.0");
    expect(Object.hasOwn(converted, "webhooks")).toBe(true);
    expect(Object.hasOwn(converted, "x-webhooks")).toBe(false);
    expect(converted.components.schemas.Pet.properties.nickname.type).toEqual(["string", "null"]);
  });

  it("preserves YAML format", async () => {
    const yaml = `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths: {}
components:
  schemas:
    Item:
      type: object
      properties:
        maybeText:
          type: string
          nullable: true
`;
    const result = await convertOAS({ oasBody: yaml, targetVersion: "3.1" });
    const converted = toYaml(result.rawBody);

    expect(result.headers["Content-Type"]).toBe("application/yaml");
    expect(result.headers["Content-Disposition"]).toBe('attachment; filename="openapi-3-1-0.yaml"');
    expect((converted as { openapi: string }).openapi).toBe("3.1.0");
  });

  it("downgrades 3.1 -> 3.0 (JSON)", async () => {
    const sourceSpec = { openapi: "3.1.0", info: { title: "Test API", version: "1.0.0" }, paths: {}, webhooks: { onEvent: { post: { responses: { 200: { description: "OK" } } } } }, components: { schemas: { Pet: { type: "object", properties: { nickname: { type: ["string", "null"] } } } } } };
    const result = await convertOAS({ oasBody: JSON.stringify(sourceSpec), targetVersion: "3.0" });
    const converted = toJson(result.rawBody);
    expect(converted.openapi).toBe("3.0.3");
    expect(Object.hasOwn(converted, "webhooks")).toBe(false);
    expect(converted.components.schemas.Pet.properties.nickname.type).toBe("string");
    expect(converted.components.schemas.Pet.properties.nickname.nullable).toBe(true);
  });

  it("keeps existing 3.1 patch version when targetVersion is omitted", async () => {
    const sourceSpec = { openapi: "3.1.2", info: { title: "Test API", version: "1.0.0" }, paths: {} };
    const result = await convertOAS({ oasBody: JSON.stringify(sourceSpec) });
    expect(toJson(result.rawBody).openapi).toBe("3.1.2");
    expect(result.headers["Content-Disposition"]).toBe('attachment; filename="openapi-3-1-2.json"');
  });
});
