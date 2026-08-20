import { describe, expect, it } from "vitest";
import { normalizeOpenApi } from "../scripts/generate-api.mjs";

const componentKinds = ["schemas", "responses", "headers", "securitySchemes"] as const;

const documentWithLegacyRoots = () => ({
  openapi: "3.0.3",
  info: { title: "Tools API", version: "1.0.0" },
  paths: {},
  components: Object.fromEntries(componentKinds.map((kind) => [kind, { example: { type: "string" } }])),
  ...Object.fromEntries(componentKinds.map((kind) => [kind, { example: { type: "string" } }])),
});

describe("normalizeOpenApi", () => {
  it("removes legacy root components when they exactly match components", () => {
    const input = documentWithLegacyRoots();
    const normalized = normalizeOpenApi(input);

    for (const kind of componentKinds) expect(normalized).not.toHaveProperty(kind);
    expect(normalized.components).toEqual(documentWithLegacyRoots().components);
    expect(input).toHaveProperty("schemas");
  });

  it("rejects a legacy root component that diverges from components", () => {
    const document = documentWithLegacyRoots();
    document.schemas = { divergent: { type: "number" } };

    expect(() => normalizeOpenApi(document)).toThrow(/schemas.*differs/i);
  });

  it("models API key and client credentials as alternatives", () => {
    const document = documentWithLegacyRoots();
    document.paths = {
      "/tools": {
        post: {
          security: [{ apiKey: [], clientCredentials: [] }],
        },
      },
    };

    expect(normalizeOpenApi(document).paths).toEqual({
      "/tools": {
        post: {
          security: [{ apiKey: [] }, { clientCredentials: [] }],
        },
      },
    });
  });
});
