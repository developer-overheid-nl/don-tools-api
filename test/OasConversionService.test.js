const assert = require("node:assert/strict");
const test = require("node:test");
const jsYaml = require("js-yaml");
const OasConversionService = require("../services/OasConversionService");

const toJson = (buffer) => JSON.parse(buffer.toString("utf8"));
const toYaml = (buffer) => jsYaml.load(buffer.toString("utf8"));

test("convert 3.0 -> 3.1 (JSON) upgrades key OpenAPI features", async () => {
  const sourceSpec = {
    openapi: "3.0.3",
    info: {
      title: "Test API",
      version: "1.0.0",
    },
    paths: {},
    "x-webhooks": {
      onEvent: {
        post: {
          responses: {
            200: {
              description: "OK",
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Pet: {
          type: "object",
          properties: {
            nickname: {
              type: "string",
              nullable: true,
            },
          },
        },
      },
    },
  };

  const result = await OasConversionService.convert({
    oasBody: JSON.stringify(sourceSpec),
    targetVersion: "3.1",
  });

  const converted = toJson(result.rawBody);

  assert.equal(result.headers["Content-Type"], "application/json");
  assert.equal(result.headers["Content-Disposition"], 'attachment; filename="openapi-3-1-0.json"');
  assert.equal(converted.openapi, "3.1.0");
  assert.ok(Object.hasOwn(converted, "webhooks"));
  assert.ok(!Object.hasOwn(converted, "x-webhooks"));
  assert.deepEqual(converted.components.schemas.Pet.properties.nickname.type, ["string", "null"]);
});

test("convert 3.1 -> 3.0 (JSON) downgrades key OpenAPI features", async () => {
  const sourceSpec = {
    openapi: "3.1.0",
    info: {
      title: "Test API",
      version: "1.0.0",
    },
    paths: {},
    webhooks: {
      onEvent: {
        post: {
          responses: {
            200: {
              description: "OK",
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Pet: {
          type: "object",
          properties: {
            nickname: {
              type: ["string", "null"],
            },
          },
        },
      },
    },
  };

  const result = await OasConversionService.convert({
    oasBody: JSON.stringify(sourceSpec),
    targetVersion: "3.0",
  });

  const converted = toJson(result.rawBody);

  assert.equal(result.headers["Content-Type"], "application/json");
  assert.equal(result.headers["Content-Disposition"], 'attachment; filename="openapi-3-0-3.json"');
  assert.equal(converted.openapi, "3.0.3");
  assert.ok(!Object.hasOwn(converted, "webhooks"));
  assert.equal(converted.components.schemas.Pet.properties.nickname.type, "string");
  assert.equal(converted.components.schemas.Pet.properties.nickname.nullable, true);
});

test("convert preserves YAML format in response", async () => {
  const sourceSpecYaml = `
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

  const result = await OasConversionService.convert({
    oasBody: sourceSpecYaml,
    targetVersion: "3.1",
  });

  const converted = toYaml(result.rawBody);

  assert.equal(result.headers["Content-Type"], "application/yaml");
  assert.equal(result.headers["Content-Disposition"], 'attachment; filename="openapi-3-1-0.yaml"');
  assert.equal(converted.openapi, "3.1.0");
  assert.deepEqual(converted.components.schemas.Item.properties.maybeText.type, ["string", "null"]);
});
