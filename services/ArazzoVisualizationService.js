"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const jsYaml = require("js-yaml");
const {
  logger: redoclyLogger,
  createConfig,
  lint,
  bundle,
  getTotals,
  formatProblems,
} = require("@redocly/openapi-core");
const Service = require("./Service");
const { fetchSpecification } = require("./RemoteSpecificationService");
const { resolveOasInput } = require("./OasInputService");
const appLogger = require("../logger");

// ---------------------------------------------------------------------------
// Constante waarden / config
// ---------------------------------------------------------------------------

const EMPTY_BODY_ERROR = "Body ontbreekt of ongeldig: gebruik oasUrl|oasBody";
const INVALID_SPEC_ERROR = "Arazzo specificatie ongeldig of mist workflows";
const TEMP_PREFIX = "don-tools-arazzo-";

const SOURCE_REF_PREFIX = "$sourceDescriptions.";
const COMPONENT_INPUTS_PREFIX = "#/components/inputs/";
const ALLOWED_METHODS = Object.freeze(
  new Set(["get", "put", "post", "delete", "patch", "head", "options", "trace"]),
);

let redoclyConfigPromise;
let arazzoLintConfigPromise;

const getRedoclyConfig = () => {
  if (!redoclyConfigPromise) {
    redoclyConfigPromise = createConfig({ extends: ["recommended"] });
  }
  return redoclyConfigPromise;
};

const getArazzoLintConfig = () => {
  if (!arazzoLintConfigPromise) {
    arazzoLintConfigPromise = createConfig({
      extends: ["recommended-strict"],
      arazzo1Rules: {
        "no-criteria-xpath": "error",
        "respect-supported-versions": "warn",
        "no-x-security-scheme-name-without-openapi": "error",
        "x-security-scheme-required-values": "error",
        "x-security-scheme-name-reference": "error",
        "no-x-security-both-scheme-and-scheme-name": "error",
      },
    });
  }
  return arazzoLintConfigPromise;
};

const isLikelyArazzoTestFile = (fileName, parsedDocument) => {
  if (!fileName || typeof fileName !== "string") return false;
  return /\.(yaml|yml|json)$/i.test(fileName) && !!parsedDocument?.arazzo;
};

const logLintSummary = (lintProblems, version) => {
  if (!Array.isArray(lintProblems) || lintProblems.length === 0) {
    return;
  }

  const totals = getTotals(lintProblems);
  formatProblems(lintProblems, { totals, version });

  if (totals.errors > 0) {
    appLogger.error("[ArazzoService] lint errors in Arazzo beschrijving", { errors: totals.errors });
  } else if (totals.warnings > 0) {
    appLogger.warn("[ArazzoService] lint waarschuwingen in Arazzo beschrijving", { warnings: totals.warnings });
  }
};

const bundleArazzoDocument = async ({
  filePath,
  base,
  externalRefResolver,
  collectSpecData,
  version = "don-tools-api",
  skipLint = false,
}) => {
  const fileName = path.basename(filePath);
  if (!fileName) {
    throw new Error("Invalid file name");
  }

  const config = await getArazzoLintConfig();
  let lintProblems = [];

  if (!skipLint) {
    lintProblems = await lint({
      ref: filePath,
      config,
      externalRefResolver,
    });

    logLintSummary(lintProblems, version);
  }

  const bundledDocument = await bundle({
    base,
    ref: filePath,
    config,
    dereference: true,
    externalRefResolver,
  });

  const parsedDocument = bundledDocument?.bundle?.parsed;

  if (!parsedDocument) {
    throw new Error(`Could not find source description file '${fileName}'.`);
  }

  if (!isLikelyArazzoTestFile(fileName, parsedDocument)) {
    throw new Error(
      `No test files found. File ${fileName} voldoet niet aan het patroon "*.[yaml|yml|json]" of mist een geldige "Arazzo" beschrijving.`,
    );
  }

  collectSpecData?.(parsedDocument);

  if (!skipLint) {
    const errors = lintProblems.filter((problem) => problem.severity === "error");
    if (errors.length > 0) {
      throw new Error(`Found errors in Arazzo description ${fileName}.`);
    }
  }

  return parsedDocument;
};

// ---------------------------------------------------------------------------
// Helpers: I/O & parsing
// ---------------------------------------------------------------------------

const normalizeText = (value) => {
  if (!value || typeof value !== "string") return "";
  return value.trim();
};

const ensureTempFile = async (contents, filename = "input.yaml") => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  const filePath = path.join(tempDir, filename);

  await fs.writeFile(filePath, contents, "utf8");

  const cleanup = async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      appLogger.warn("[ArazzoService] opruimen temp dir faalde", {
        tempDir,
        message: error?.message,
      });
    }
  };

  return { filePath, cleanup };
};

const parseYamlOrUndefined = (contents) => {
  try {
    const parsed = jsYaml.load(contents);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// Input normalisatie (body / URL / oas*)
// ---------------------------------------------------------------------------

/**
 * Normaliseert de input naar `{ source, contents }`.
 * Ondersteunt:
 * - `arazzoBody` (string)
 * - `arazzoUrl` (URL)
 * - fallback naar `resolveOasInput` (oasUrl/oasBody/etc.)
 */
const resolveVisualizationInput = async (input) => {
  if (!input || typeof input !== "object") {
    throw Service.rejectResponse({ message: EMPTY_BODY_ERROR }, 400);
  }

  const { arazzoBody, arazzoUrl } = input;

  // 1) Directe Arazzo-body
  if (typeof arazzoBody === "string" && arazzoBody.trim().length > 0) {
    return {
      source: "request-body",
      contents: arazzoBody,
    };
  }

  // 2) Arazzo-URL
  if (typeof arazzoUrl === "string" && arazzoUrl.trim().length > 0) {
    let parsedUrl;
    try {
      parsedUrl = new URL(arazzoUrl);
    } catch {
      throw Service.rejectResponse(
        {
          message: "De waarde van arazzoUrl is geen geldige URL.",
        },
        400,
      );
    }

    const contents = await fetchSpecification(parsedUrl.toString(), {
      errorMessage: "Het ophalen van de Arazzo specificatie is mislukt.",
    });

    return {
      source: parsedUrl.toString(),
      contents,
    };
  }

  // 3) Fallback: dit beschouwen we als OpenAPI input (oasUrl/oasBody/etc.)
  const resolved = await resolveOasInput(input);
  const trimmed = typeof resolved.contents === "string" ? resolved.contents.trim() : "";

  if (!trimmed) {
    throw Service.rejectResponse({ message: EMPTY_BODY_ERROR }, 400);
  }

  return {
    source: resolved.source,
    contents: trimmed,
  };
};

// ---------------------------------------------------------------------------
// Arazzo-document ophalen / genereren
// ---------------------------------------------------------------------------

/**
 * Bundelt een Arazzo-document vanuit YAML/JSON met respect-core (bundleArazzo).
 */
const loadArazzoDocumentFromContents = async (contents) => {
  const { filePath, cleanup } = await ensureTempFile(contents, "arazzo.yaml");

  try {
    const document = await bundleArazzoDocument({
      filePath,
      base: path.dirname(filePath),
      externalRefResolver: undefined,
      collectSpecData: undefined,
      version: "don-tools-api",
      skipLint: true,
    });

    if (!document || !Array.isArray(document.workflows) || document.workflows.length === 0) {
      throw new Error(INVALID_SPEC_ERROR);
    }

    return document;
  } catch (error) {
    appLogger.error("[ArazzoService] bundelen Arazzo-document mislukt", {
      message: error?.message,
      detail: error?.detail,
      stack: error?.stack,
    });
    throw error;
  } finally {
    await cleanup();
  }
};

/**
 * Genereert Arazzo-workflows vanuit een OpenAPI-spec via respect-core (generate).
 */
const generateArazzoFromOpenApi = async (contents) => {
  const { filePath, cleanup } = await ensureTempFile(contents, "openapi.yaml");

  try {
    const { generate } = await import("@redocly/respect-core");
    const config = await getRedoclyConfig();

    const document = await generate({
      descriptionPath: filePath,
      collectSpecData: undefined,
      version: "don-tools-api",
      config,
      base: path.dirname(filePath),
    });

    if (!document || !Array.isArray(document.workflows) || document.workflows.length === 0) {
      throw new Error(INVALID_SPEC_ERROR);
    }

    return document;
  } catch (error) {
    appLogger.error("[ArazzoService] generate from OpenAPI failed", {
      message: error?.message,
      stack: error?.stack,
    });

    throw Service.rejectResponse(
      {
        message: "Kon Arazzo workflows genereren vanuit OpenAPI.",
        detail: error.message,
      },
      400,
    );
  } finally {
    await cleanup();
  }
};

// ---------------------------------------------------------------------------
// OpenAPI helpers (operation lookup / schema beschrijving)
// ---------------------------------------------------------------------------

const buildOperationLookup = (openapiDocument) => {
  const lookup = new Map();

  if (!openapiDocument || typeof openapiDocument !== "object") return lookup;

  const { paths } = openapiDocument;
  if (!paths || typeof paths !== "object") return lookup;

  Object.entries(paths).forEach(([pathKey, pathItem]) => {
    if (!pathItem || typeof pathItem !== "object") return;

    Object.entries(pathItem).forEach(([method, operation]) => {
      if (!ALLOWED_METHODS.has(method) || !operation || typeof operation !== "object") return;

      const { operationId } = operation;
      if (!operationId) return;

      lookup.set(operationId, {
        method: method.toUpperCase(),
        path: pathKey,
        summary: normalizeText(operation.summary),
        description: normalizeText(operation.description),
        tags: Array.isArray(operation.tags) ? operation.tags : undefined,
      });
    });
  });

  return lookup;
};

const describeSchemaType = (schema) => {
  if (!schema || typeof schema !== "object") return "";

  const parts = [];

  if (schema.type) {
    parts.push(schema.type + (schema.format ? ` (${schema.format})` : ""));
  } else if (schema.format) {
    parts.push(schema.format);
  }

  if (schema.enum) {
    parts.push(`mogelijk: ${schema.enum.join(", ")}`);
  }

  return parts.join(" | ");
};

const formatInputDefinition = (name, schema) => {
  const lines = [`- **${name}**`];
  const description = normalizeText(schema?.description);
  const typeInfo = describeSchemaType(schema);

  if (description || typeInfo) {
    const details = [description, typeInfo ? `type: ${typeInfo}` : undefined]
      .filter(Boolean)
      .join(" | ");
    lines.push(`  - ${details}`);
  }

  if (schema && typeof schema === "object" && schema.properties && typeof schema.properties === "object") {
    lines.push("  - Velden:");
    Object.entries(schema.properties).forEach(([propName, propSchema]) => {
      const propType = describeSchemaType(propSchema);
      const propDescription = normalizeText(propSchema?.description);
      const suffix = [propType, propDescription].filter(Boolean).join(" — ");
      lines.push(`    - ${propName}${suffix ? ` — ${suffix}` : ""}`);
    });
  }

  return lines;
};

const resolveInputs = (inputs, components) => {
  if (!inputs) return [];

  // $ref naar #/components/inputs/*
  if (inputs.$ref && typeof inputs.$ref === "string") {
    if (!inputs.$ref.startsWith(COMPONENT_INPUTS_PREFIX)) return [];

    const refName = inputs.$ref.slice(COMPONENT_INPUTS_PREFIX.length);
    const definition = components?.[refName];
    if (!definition) return [];

    return [{ name: refName, schema: definition }];
  }

  // Inline definitie
  if (typeof inputs === "object") {
    const inlineName = inputs.name || inputs.title || "inputs";
    return [{ name: inlineName, schema: inputs }];
  }

  return [];
};

const formatParameterValue = (value) => {
  if (typeof value === "string") return value;
  if (value === undefined) return "onbekend";
  return JSON.stringify(value);
};

const appendCriteriaLines = (lines, items, label) => {
  if (!Array.isArray(items) || items.length === 0) return;

  lines.push(`  - ${label}:`);
  items.forEach((criteria) => {
    const condition = normalizeText(criteria?.condition) || "(geen conditie)";
    const detail = normalizeText(criteria?.description);
    lines.push(`    - ${condition}${detail ? ` — ${detail}` : ""}`);
  });
};

const appendOutputs = (lines, outputs) => {
  if (!outputs || typeof outputs !== "object" || Object.keys(outputs).length === 0) return;

  lines.push("  - Outputs:");
  Object.entries(outputs).forEach(([key, value]) => {
    lines.push(`    - ${key}: ${JSON.stringify(value)}`);
  });
};

const parseStepOperation = (value) => {
  if (!value || typeof value !== "string") {
    return { raw: "", operationId: "" };
  }

  if (!value.startsWith(SOURCE_REF_PREFIX)) {
    return { raw: value, operationId: value };
  }

  const remainder = value.slice(SOURCE_REF_PREFIX.length);
  const delimiterIndex = remainder.indexOf(".");

  if (delimiterIndex === -1) {
    return { raw: value, operationId: remainder };
  }

  return {
    raw: value,
    source: remainder.slice(0, delimiterIndex),
    operationId: remainder.slice(delimiterIndex + 1),
  };
};

const describeStepOperation = (step, operationLookup) => {
  const parsedOperation = parseStepOperation(step.operationId);
  const operationDetails = parsedOperation.operationId ? operationLookup.get(parsedOperation.operationId) : undefined;

  const suffixParts = [];

  if (operationDetails?.method && operationDetails.path) {
    suffixParts.push(`${operationDetails.method} ${operationDetails.path}`);
  }

  if (parsedOperation.operationId) {
    suffixParts.push(parsedOperation.operationId);
  }

  const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(" · ")})` : "";

  return { parsedOperation, operationDetails, suffix };
};

// ---------------------------------------------------------------------------
// Markdown output
// ---------------------------------------------------------------------------

const buildMarkdown = (document, options = {}) => {
  const lines = [];
  const title = normalizeText(document.info?.title) || "Arazzo Workflows";
  const description = normalizeText(document.info?.description);
  const operationLookup = buildOperationLookup(options.openapi);

  lines.push(`# ${title}`);
  if (description) {
    lines.push("", description);
  }

  (document.workflows || []).forEach((workflow, workflowIndex) => {
    const workflowTitle =
      normalizeText(workflow.summary) || workflow.workflowId || `Workflow ${workflowIndex + 1}`;

    lines.push("", `## ${workflowTitle}`);

    if (workflow.description) {
      lines.push("", workflow.description.trim());
    }

    // Inputs
    const inputs = resolveInputs(workflow.inputs, document.components?.inputs);
    if (inputs.length > 0) {
      lines.push("", "### Inputs");
      inputs.forEach((input) => {
        formatInputDefinition(input.name, input.schema).forEach((line) => {
          lines.push(line);
        });
      });
    }

    // Parameters
    if (Array.isArray(workflow.parameters) && workflow.parameters.length > 0) {
      lines.push("", "### Parameters");
      workflow.parameters.forEach((parameter) => {
        const location = parameter.in || "parameter";
        const name = parameter.name || "naamloos";
        const value = formatParameterValue(parameter.value);

        lines.push(`- ${name} (${location}) = ${value}`);
        if (parameter.description) {
          lines.push(`  - ${parameter.description.trim()}`);
        }
      });
    }

    // Steps
    if (Array.isArray(workflow.steps) && workflow.steps.length > 0) {
      lines.push("", "### Stappen");
      workflow.steps.forEach((step, index) => {
        const stepLabel = step.stepId || `Stap ${index + 1}`;
        const { operationDetails, suffix } = describeStepOperation(step, operationLookup);

        lines.push(`- **${stepLabel}${suffix}**`);

        const summary = operationDetails?.summary;
        const descriptionText = operationDetails?.description;

        if (summary) {
          lines.push(`  - ${summary}`);
        }

        if (descriptionText && descriptionText !== summary) {
          lines.push(`  - ${descriptionText}`);
        }

        const stepDescription = normalizeText(step.description);
        if (
          stepDescription &&
          stepDescription !== summary &&
          stepDescription !== descriptionText
        ) {
          lines.push(`  - ${stepDescription}`);
        }

        appendCriteriaLines(lines, step.successCriteria, "Succescriteria");
        appendCriteriaLines(lines, step.failureCriteria, "Faalcriteria");
        appendOutputs(lines, step.outputs);
      });
    }
  });

  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Mermaid output
// ---------------------------------------------------------------------------

const escapeMermaidLabel = (value) => {
  if (!value) return "";
  return String(value).replace(/"/g, '\\"');
};

const sanitizeMermaidId = (value, fallback) => {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  const sanitized = value.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!sanitized) {
    return fallback;
  }

  if (/^[0-9]/.test(sanitized)) {
    return `S_${sanitized}`;
  }

  return sanitized;
};

const buildMermaid = (document, options = {}) => {
  const operationLookup = buildOperationLookup(options.openapi);
  const lines = ["flowchart TD"];

  (document.workflows || []).forEach((workflow, workflowIndex) => {
    const workflowTitle =
      normalizeText(workflow.summary) || workflow.workflowId || `Workflow ${workflowIndex + 1}`;

    lines.push("", `subgraph "${escapeMermaidLabel(workflowTitle)}"`);

    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    if (steps.length === 0) {
      lines.push('    EmptyWorkflow["Geen stappen gedefinieerd"]');
      lines.push("end");
      return;
    }

    const workflowKey = sanitizeMermaidId(
      workflow.workflowId || `workflow_${workflowIndex + 1}`,
      `workflow_${workflowIndex + 1}`,
    );

    const nodeIds = steps.map((step, index) => {
      const stepKey = sanitizeMermaidId(step.stepId || `step_${index + 1}`, `step_${index + 1}`);
      return `${workflowKey}_${stepKey}`;
    });

    steps.forEach((step, index) => {
      const stepLabel = step.stepId || `Stap ${index + 1}`;
      const { suffix } = describeStepOperation(step, operationLookup);
      const label = escapeMermaidLabel(`${stepLabel}${suffix}`);
      lines.push(`    ${nodeIds[index]}["${label}"]`);
    });

    for (let i = 0; i < nodeIds.length - 1; i += 1) {
      lines.push(`    ${nodeIds[i]} --> ${nodeIds[i + 1]}`);
    }

    lines.push("end");
  });

  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Conversie-functies: input -> Arazzo-document
// ---------------------------------------------------------------------------

/**
 * Hoofd-conversie:
 * - Detecteert automatisch Arazzo vs OpenAPI.
 * - Retourneert een Arazzo-document + optioneel het OpenAPI-document.
 */
const convertInputToArazzo = async (input) => {
  const resolved = await resolveVisualizationInput(input);

  if (!resolved.contents || typeof resolved.contents !== "string" || !resolved.contents.trim()) {
    throw Service.rejectResponse({ message: EMPTY_BODY_ERROR }, 400);
  }

  const contents = resolved.contents;
  const parsed = parseYamlOrUndefined(contents);
  const isArazzoSpecification = Boolean(parsed && parsed.arazzo);
  const openapiDocument = parsed && !isArazzoSpecification ? parsed : undefined;

  try {
    const arazzoDocument = isArazzoSpecification
      ? await loadArazzoDocumentFromContents(contents)
      : await generateArazzoFromOpenApi(contents);

    return {
      source: resolved.source,
      arazzoDocument,
      openapiDocument,
    };
  } catch (error) {
    if (Service.isErrorResponse && Service.isErrorResponse(error)) {
      throw error;
    }

    appLogger.error("[ArazzoService] Arazzo conversie mislukt", {
      message: error?.message,
      detail: error?.detail,
      stack: error?.stack,
    });

    throw Service.rejectResponse(
      {
        message: error?.message && error.message !== "Unknown error" ? error.message : INVALID_SPEC_ERROR,
        detail: error?.message,
      },
      400,
    );
  }
};

const convertOasInputToArazzo = async (input) => {
  const resolved = await resolveOasInput(input);
  const contents = typeof resolved.contents === "string" ? resolved.contents.trim() : "";

  if (!contents) {
    throw Service.rejectResponse({ message: EMPTY_BODY_ERROR }, 400);
  }

  const openapiDocument = parseYamlOrUndefined(contents) || undefined;
  const arazzoDocument = await generateArazzoFromOpenApi(contents);

  return {
    source: resolved.source,
    arazzoDocument,
    openapiDocument,
  };
};

// ---------------------------------------------------------------------------
// Publieke helpers: Arazzo-document -> Markdown / Mermaid
// ---------------------------------------------------------------------------

const buildMarkdownFromArazzo = (arazzoDocument, { openapi } = {}) =>
  buildMarkdown(arazzoDocument, { openapi });

const buildMermaidFromArazzo = (arazzoDocument, { openapi } = {}) =>
  buildMermaid(arazzoDocument, { openapi });

// ---------------------------------------------------------------------------
// Hoofdfunctie: alles-in-één visualisatie
// ---------------------------------------------------------------------------

/**
 * Convenience: input (OAS of Arazzo) -> `{ markdown, mermaid }`
 */
const visualize = async (input) => {
  const { arazzoDocument, openapiDocument } = await convertInputToArazzo(input);

  return {
    markdown: buildMarkdownFromArazzo(arazzoDocument, { openapi: openapiDocument }),
    mermaid: buildMermaidFromArazzo(arazzoDocument, { openapi: openapiDocument }),
  };
};

module.exports = {
  visualize,
  convertInputToArazzo,
  convertOasInputToArazzo,
  buildMarkdownFromArazzo,
  buildMermaidFromArazzo,
};
