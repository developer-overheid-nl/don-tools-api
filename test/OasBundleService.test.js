const assert = require("node:assert/strict");
const test = require("node:test");
const OasBundleService = require("../services/OasBundleService");

test("bundle rejects recursive OpenAPI schemas with 422 and command detail", async () => {
  const sourceSpec = {
    openapi: "3.0.3",
    info: {
      title: "Recursive API",
      version: "1.0.0",
    },
    paths: {},
    components: {
      schemas: {
        Node: {
          type: "object",
          properties: {
            children: {
              type: "array",
              items: {
                $ref: "#/components/schemas/Node",
              },
            },
          },
        },
      },
    },
  };

  await assert.rejects(
    () => OasBundleService.bundle({ oasBody: JSON.stringify(sourceSpec) }),
    (error) => {
      assert.equal(error.code, 422);
      assert.equal(
        error.error.message,
        "De OpenAPI specificatie bevat circulaire verwijzingen en kan niet volledig worden gedereferenced.",
      );
      assert.match(error.error.detail, /circular reference/i);
      return true;
    },
  );
});
