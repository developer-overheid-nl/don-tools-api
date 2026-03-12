const { Converter } = require("@apiture/openapi-down-convert");
const { upgrade: scalarUpgrade } = require("@scalar/openapi-upgrader");
const jsYaml = require("js-yaml");
const Service = require("./Service");
const { resolveOasInput } = require("./OasInputService");
const logger = require("../logger");

const DEFAULT_TARGET_VERSION = "3.1.0";

const EMPTY_BODY_ERROR = "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody";
const VERSION_MISSING_ERROR = "OpenAPI document bevat geen geldig openapi versieveld";
const UNSUPPORTED_VERSION_ERROR = "Alleen OpenAPI 3.0 en 3.1 worden ondersteund";
const UNSUPPORTED_TARGET_VERSION_ERROR = "targetVersion wordt niet ondersteund. Gebruik 3.0 of 3.1.";

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

const normalizeVersionInput = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
};

const resolveVersionDescriptor = (value) => {
  const raw = normalizeVersionInput(value);
  if (!raw) {
    return null;
  }
  if (raw === "3") {
    return { major: "3.0", canonical: "3.0.3" };
  }
  if (raw.startsWith("3.0")) {
    return { major: "3.0", canonical: "3.0.3" };
  }
  if (raw.startsWith("3.1")) {
    return { major: "3.1", canonical: "3.1.0" };
  }
  return null;
};

const normalizeTargetVersion = (value) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_TARGET_VERSION;
  }
  const descriptor = resolveVersionDescriptor(value);
  if (!descriptor) {
    throw Service.rejectResponse(
      {
        message: UNSUPPORTED_TARGET_VERSION_ERROR,
      },
      400,
    );
  }
  return descriptor.canonical;
};

const ensureObjectSpec = (value, errorMessage) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  return value;
};

const convertSpec = async (spec, targetVersion) => {
  const sourceDescriptor = resolveVersionDescriptor(spec.openapi);
  const openapiValue = spec.openapi;
  const rawVersion = openapiValue === undefined || openapiValue === null ? "" : String(openapiValue).trim();
  if (rawVersion.length === 0 || !sourceDescriptor) {
    throw Service.rejectResponse({ message: VERSION_MISSING_ERROR }, 400);
  }

  const targetDescriptor = resolveVersionDescriptor(targetVersion);
  if (!targetDescriptor) {
    throw Service.rejectResponse({ message: UNSUPPORTED_TARGET_VERSION_ERROR }, 400);
  }

  if (sourceDescriptor.major === targetDescriptor.major) {
    spec.openapi = targetDescriptor.canonical;
    return { spec, resolvedVersion: targetDescriptor.canonical };
  }

  if (sourceDescriptor.major === "3.0" && targetDescriptor.major === "3.1") {
    const upgraded = ensureObjectSpec(
      scalarUpgrade(spec, "3.1"),
      "Scalar OpenAPI upgrader retourneerde een ongeldig document.",
    );
    upgraded.openapi = targetDescriptor.canonical;
    return { spec: upgraded, resolvedVersion: targetDescriptor.canonical };
  }

  if (sourceDescriptor.major === "3.1" && targetDescriptor.major === "3.0") {
    const downConverter = new Converter(spec);
    const downgraded = ensureObjectSpec(
      downConverter.convert(),
      "OpenAPI down converter retourneerde een ongeldig document.",
    );
    downgraded.openapi = targetDescriptor.canonical;
    return { spec: downgraded, resolvedVersion: targetDescriptor.canonical };
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

const extractTargetVersion = (input) => {
  if (input && typeof input === "object" && !Array.isArray(input) && typeof input.targetVersion === "string") {
    return input.targetVersion;
  }
  return undefined;
};

const convert = async (input) => {
  const targetVersion = normalizeTargetVersion(extractTargetVersion(input));
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
    const { spec: convertedSpec, resolvedVersion } = await convertSpec(spec, targetVersion);
    const { buffer, contentType, filename } = serializeSpecification(convertedSpec, format, resolvedVersion);
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
