const jsYaml = require("js-yaml");
const Service = require("./Service");
const { resolveOasInput } = require("./OasInputService");
const logger = require("../logger");

const JSON_SCHEMA_DIALECT_BASE = "https://spec.openapis.org/oas/3.1/dialect/base";

const EMPTY_BODY_ERROR = "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody";
const VERSION_MISSING_ERROR = "OpenAPI document bevat geen geldig openapi versieveld";
const UNSUPPORTED_VERSION_ERROR = "Alleen OpenAPI 3.0 en 3.1 worden ondersteund";

const parseSpecification = (contents) => {
  const trimmed = contents.trim();
  if (trimmed.length === 0) {
    throw Service.rejectResponse({ message: EMPTY_BODY_ERROR }, 400);
  }
  try {
    const spec = JSON.parse(trimmed);
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      throw new Error("Ongeldig OpenAPI document");
    }
    return { spec, format: "json" };
  } catch (_jsonError) {
    try {
      const spec = jsYaml.load(trimmed);
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
        throw new Error("Ongeldig OpenAPI document");
      }
      return { spec, format: "yaml" };
    } catch (yamlError) {
      throw new Error(`Kan OpenAPI specificatie niet parseren: ${yamlError.message}`);
    }
  }
};

const mergeTypeWithNull = (target) => {
  const current = target.type;
  if (Array.isArray(current)) {
    const hasNull = current.some((value) => value === "null");
    target.type = hasNull ? current : [...current, "null"];
    return;
  }
  if (typeof current === "string" && current.length > 0) {
    target.type = [current, "null"];
    return;
  }
  target.type = ["null"];
};

const convertSchemas30To31 = (node) => {
  if (Array.isArray(node)) {
    for (const item of node) {
      convertSchemas30To31(item);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  Object.entries(node).forEach(([key, value]) => {
    convertSchemas30To31(value);
    node[key] = value;
  });
  if (node.nullable === true) {
    mergeTypeWithNull(node);
    delete node.nullable;
  }
};

const normalizeTypeArray = (target) => {
  const currentType = target.type;
  if (!Array.isArray(currentType)) {
    return;
  }
  const filtered = [];
  let hasNull = false;
  currentType.forEach((item) => {
    if (item === null || item === undefined) {
      return;
    }
    if (typeof item === "string" && item === "null") {
      hasNull = true;
      return;
    }
    filtered.push(item);
  });
  if (hasNull) {
    target.nullable = true;
  }
  if (filtered.length === 0) {
    delete target.type;
  } else if (filtered.length === 1) {
    [target.type] = filtered;
  } else {
    target.type = filtered;
  }
};

const normalizeEnumNull = (target) => {
  const { enum: enumValues } = target;
  if (!Array.isArray(enumValues)) {
    return;
  }
  const filtered = [];
  let hasNull = false;
  enumValues.forEach((value) => {
    if (value === null) {
      hasNull = true;
      return;
    }
    filtered.push(value);
  });
  if (hasNull) {
    target.nullable = true;
  }
  if (filtered.length === 0) {
    delete target.enum;
    return;
  }
  if (filtered.length !== enumValues.length) {
    target.enum = filtered;
  }
};

const convertSchemas31To30 = (node) => {
  if (Array.isArray(node)) {
    for (const item of node) {
      convertSchemas31To30(item);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  Object.entries(node).forEach(([key, value]) => {
    convertSchemas31To30(value);
    node[key] = value;
  });
  if (Object.hasOwn(node, "const")) {
    if (!Object.hasOwn(node, "enum")) {
      node.enum = [node.const];
    }
    delete node.const;
  }
  normalizeTypeArray(node);
  normalizeEnumNull(node);
};

const convertSpec = (spec) => {
  const openapiValue = spec.openapi;
  const rawVersion = openapiValue === undefined || openapiValue === null ? "" : String(openapiValue).trim();
  if (rawVersion.length === 0) {
    throw Service.rejectResponse({ message: VERSION_MISSING_ERROR }, 400);
  }

  if (rawVersion.startsWith("3.0")) {
    const targetVersion = "3.1.0";
    convertSchemas30To31(spec);
    if (!Object.hasOwn(spec, "jsonSchemaDialect")) {
      spec.jsonSchemaDialect = JSON_SCHEMA_DIALECT_BASE;
    }
    if (Object.hasOwn(spec, "x-webhooks")) {
      if (!Object.hasOwn(spec, "webhooks")) {
        spec.webhooks = spec["x-webhooks"];
      }
      delete spec["x-webhooks"];
    }
    spec.openapi = targetVersion;
    return targetVersion;
  }
  if (rawVersion.startsWith("3.1")) {
    const targetVersion = "3.0.3";
    convertSchemas31To30(spec);
    delete spec.jsonSchemaDialect;
    if (Object.hasOwn(spec, "webhooks")) {
      if (!Object.hasOwn(spec, "x-webhooks")) {
        spec["x-webhooks"] = spec.webhooks;
      }
      delete spec.webhooks;
    }
    spec.openapi = targetVersion;
    return targetVersion;
  }
  throw Service.rejectResponse({ message: UNSUPPORTED_VERSION_ERROR }, 400);
};

const serializeSpecification = (spec, format, targetVersion) => {
  const filenameBase = `openapi-${targetVersion.replace(/\./g, "-")}`;
  if (format === "json") {
    const json = JSON.stringify(spec, null, 2);
    return {
      buffer: Buffer.from(json, "utf8"),
      contentType: "application/json",
      filename: `${filenameBase}.json`,
    };
  }
  const yaml = jsYaml.dump(spec, { lineWidth: -1 });
  return {
    buffer: Buffer.from(yaml, "utf8"),
    contentType: "application/yaml",
    filename: `${filenameBase}.yaml`,
  };
};

const convert = async (input) => {
  const { contents } = await resolveOasInput(input);
  let parsed;
  try {
    parsed = parseSpecification(contents);
  } catch (error) {
    logger.error(
      `[OasConversionService] parseSpecification failed: ${error?.message || "unknown"}${
        error?.stack ? ` stack=${error.stack}` : ""
      }`,
    );
    if (Service.isErrorResponse(error)) {
      throw error;
    }
    throw Service.rejectResponse(
      {
        message: error.message,
      },
      500,
    );
  }
  const { spec, format } = parsed;
  try {
    const targetVersion = convertSpec(spec);
    const { buffer, contentType, filename } = serializeSpecification(spec, format, targetVersion);
    return {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
      rawBody: buffer,
    };
  } catch (error) {
    logger.error(
      `[OasConversionService] convertSpec failed: ${error?.message || "unknown"}${
        error?.stack ? ` stack=${error.stack}` : ""
      }`,
    );
    if (Service.isErrorResponse(error)) {
      throw error;
    }
    throw Service.rejectResponse(
      {
        message: error.message || "Er is een fout opgetreden tijdens het converteren.",
      },
      500,
    );
  }
};

module.exports = {
  convert,
};
