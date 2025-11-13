const { kebabCase, upperCamelCase } = require("case-anything");
const Service = require("./Service");
const { resolveOasInput } = require("./OasInputService");
const { sanitizeFileName } = require("../utils/fileName");
const logger = require("../logger");

const EMPTY_BODY_ERROR = "Body ontbreekt of heeft een ongeldig formaat.";
const INVALID_JSON_ERROR = "Het aangeleverde JSON-document kon niet worden gelezen.";
const MISSING_VALUE_ERROR = (field) => `Eigenschap '${field}' ontbreekt of is ongeldig.`;
const NO_RESOURCES_ERROR = "Geef minimaal één resource op in het 'resources' veld.";

const toUppercase = (value) => {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const requireString = (value, fieldName) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Service.rejectResponse(
      {
        message: MISSING_VALUE_ERROR(fieldName),
        detail: `${fieldName} moet een niet-lege string zijn.`,
      },
      400,
    );
  }
  return value.trim();
};

const requireObject = (value, fieldName) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Service.rejectResponse(
      {
        message: MISSING_VALUE_ERROR(fieldName),
        detail: `${fieldName} moet een object zijn.`,
      },
      400,
    );
  }
  return value;
};

const normalizeContact = (contact) => {
  const source = requireObject(contact, "contact");
  return {
    name: requireString(source.name, "contact.name"),
    email: requireString(source.email, "contact.email"),
    url: requireString(source.url, "contact.url"),
  };
};

const normalizeResources = (resources) => {
  if (!Array.isArray(resources) || resources.length === 0) {
    throw Service.rejectResponse(
      {
        message: NO_RESOURCES_ERROR,
        detail: NO_RESOURCES_ERROR,
      },
      400,
    );
  }
  return resources.map((resource, index) => {
    const source = requireObject(resource, `resources[${index}]`);
    return {
      name: requireString(source.name, `resources[${index}].name`),
      plural: requireString(source.plural, `resources[${index}].plural`),
      readonly: Boolean(source.readonly),
    };
  });
};

const parseGeneratorConfig = (contents) => {
  if (typeof contents !== "string" || contents.trim().length === 0) {
    throw Service.rejectResponse(
      {
        message: EMPTY_BODY_ERROR,
      },
      400,
    );
  }
  try {
    const parsed = JSON.parse(contents);
    const normalized = requireObject(parsed, "root");
    return {
      title: requireString(normalized.title, "title"),
      description: requireString(normalized.description, "description"),
      contact: normalizeContact(normalized.contact),
      resources: normalizeResources(normalized.resources),
    };
  } catch (error) {
    if (Service.isErrorResponse(error)) {
      throw error;
    }
    throw Service.rejectResponse(
      {
        message: INVALID_JSON_ERROR,
        detail: error?.message || INVALID_JSON_ERROR,
      },
      400,
    );
  }
};

const createEndpointSingle = (resource) => {
  const baseName = upperCamelCase(resource.name);
  const schemaRef = `#/components/schemas/${baseName}`;
  const pluralLabel = toUppercase(resource.plural);
  const singularLabel = toUppercase(resource.name);
  const endpoint = {
    parameters: [
      {
        $ref: "#/components/parameters/id",
      },
    ],
    get: {
      operationId: `retrieve${baseName}`,
      description: `${singularLabel} ophalen`,
      summary: `${singularLabel} ophalen`,
      tags: [pluralLabel],
      responses: {
        200: {
          headers: {
            "API-Version": {
              $ref: "https://static.developer.overheid.nl/adr/components.yaml#/headers/API-Version",
            },
          },
          description: "OK",
          content: {
            "application/json": {
              schema: {
                $ref: schemaRef,
              },
            },
          },
        },
        404: {
          $ref: "https://static.developer.overheid.nl/adr/components.yaml#/responses/404",
        },
      },
    },
  };
  if (!resource.readonly) {
    endpoint.put = {
      operationId: `edit${baseName}`,
      description: `${singularLabel} wijzigen`,
      summary: `${singularLabel} wijzigen`,
      tags: [pluralLabel],
      responses: {
        200: {
          headers: {
            "API-Version": {
              $ref: "https://static.developer.overheid.nl/adr/components.yaml#/headers/API-Version",
            },
          },
          description: "OK",
          content: {
            "application/json": {
              schema: {
                $ref: schemaRef,
              },
            },
          },
        },
        400: {
          $ref: "https://static.developer.overheid.nl/adr/components.yaml#/responses/400",
        },
      },
    };
    endpoint.delete = {
      operationId: `remove${baseName}`,
      description: `${singularLabel} verwijderen`,
      summary: `${singularLabel} verwijderen`,
      tags: [pluralLabel],
      responses: {
        204: {
          $ref: "https://static.developer.overheid.nl/adr/components.yaml#/responses/204",
        },
        404: {
          $ref: "https://static.developer.overheid.nl/adr/components.yaml#/responses/404",
        },
      },
    };
  }
  return endpoint;
};

const createEndpointList = (resource) => {
  const pluralName = upperCamelCase(resource.plural);
  const schemaRef = `#/components/schemas/${upperCamelCase(resource.name)}`;
  const pluralLabel = toUppercase(resource.plural);
  const endpoint = {
    get: {
      operationId: `list${pluralName}`,
      description: `Alle ${resource.plural} ophalen`,
      summary: `Alle ${resource.plural} ophalen`,
      tags: [pluralLabel],
      responses: {
        200: {
          headers: {
            "API-Version": {
              $ref: "https://static.developer.overheid.nl/adr/components.yaml#/headers/API-Version",
            },
            Link: {
              $ref: "https://static.developer.overheid.nl/adr/components.yaml#/headers/Link",
            },
          },
          description: "OK",
          content: {
            "application/json": {
              schema: {
                $ref: schemaRef,
              },
            },
          },
        },
      },
    },
  };
  if (!resource.readonly) {
    endpoint.post = {
      operationId: `create${pluralName}`,
      description: `Nieuwe ${resource.name} aanmaken`,
      summary: `Nieuwe ${resource.name} aanmaken`,
      tags: [pluralLabel],
      responses: {
        201: {
          headers: {
            "API-Version": {
              $ref: "https://static.developer.overheid.nl/adr/components.yaml#/headers/API-Version",
            },
          },
          description: "Created",
          content: {
            "application/json": {
              schema: {
                $ref: schemaRef,
              },
            },
          },
        },
        400: {
          $ref: "https://static.developer.overheid.nl/adr/components.yaml#/responses/400",
        },
      },
    };
  }
  return endpoint;
};

const createPaths = (resources) =>
  resources.reduce((paths, resource) => {
    const pluralPath = kebabCase(resource.plural);
    paths[`/${pluralPath}`] = createEndpointList(resource);
    paths[`/${pluralPath}/{id}`] = createEndpointSingle(resource);
    return paths;
  }, {});

const createSchemas = (resources) =>
  resources.reduce((schemas, resource) => {
    const schemaName = upperCamelCase(resource.name);
    schemas[schemaName] = {
      type: "object",
      properties: {
        id: {
          type: "string",
          format: "uuid",
        },
      },
    };
    return schemas;
  }, {});

const buildOpenApiDocument = (config) => ({
  openapi: "3.0.2",
  info: {
    title: config.title,
    description: config.description,
    version: "1.0.0",
    contact: {
      name: config.contact.name,
      email: config.contact.email,
      url: config.contact.url,
    },
  },
  servers: [
    {
      url: "@TODO: Add server URL",
    },
  ],
  tags: config.resources.map((resource) => {
    const tag = toUppercase(resource.plural);
    return {
      name: tag,
      description: `Alle API operaties die bij ${resource.plural} horen.`,
    };
  }),
  paths: createPaths(config.resources),
  components: {
    schemas: createSchemas(config.resources),
    parameters: {
      id: {
        name: "id",
        in: "path",
        description: "id",
        required: true,
        schema: {
          type: "string",
        },
      },
    },
  },
});

const deriveFilename = (title) => {
  const sanitized = sanitizeFileName(title, { fallback: "openapi-boilerplate", lowercase: true });
  return (sanitized && `${sanitized}.json`) || "openapi-boilerplate.json";
};

const generate = async (input) => {
  const { contents } = await resolveOasInput(input);
  let config;
  try {
    config = parseGeneratorConfig(contents);
  } catch (error) {
    logger.error(
      `[OasGeneratorService] parseGeneratorConfig failed: ${error?.detail || error?.message || "unknown"}`,
    );
    throw error;
  }

  try {
    const document = buildOpenApiDocument(config);
    const filename = deriveFilename(config.title);
    const buffer = Buffer.from(JSON.stringify(document, null, 2), "utf8");
    return {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
      rawBody: buffer,
    };
  } catch (error) {
    logger.error(
      `[OasGeneratorService] buildOpenApiDocument failed: ${error?.message || "unknown"}${
        error?.stack ? ` stack=${error.stack}` : ""
      }`,
    );
    throw Service.rejectResponse(
      {
        message: "Er is een fout opgetreden tijdens het genereren van de OpenAPI specificatie.",
      },
      500,
    );
  }
};

module.exports = {
  generate,
};
