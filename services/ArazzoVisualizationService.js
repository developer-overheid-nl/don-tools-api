const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const jsYaml = require("js-yaml");
const { logger: redoclyLogger, createConfig } = require("@redocly/openapi-core");
const Service = require("./Service");
const { fetchSpecification } = require("./RemoteSpecificationService");
const { resolveOasInput } = require("./OasInputService");
const appLogger = require("../logger");

const EMPTY_BODY_ERROR = "Body ontbreekt of ongeldig: gebruik oasUrl|oasBody";
const INVALID_SPEC_ERROR = "Arazzo specificatie ongeldig of mist workflows";
const TEMP_PREFIX = "don-tools-arazzo-";

let redoclyConfigPromise;
const getRedoclyConfig = () => {
  if (!redoclyConfigPromise) {
    redoclyConfigPromise = createConfig({ extends: ["recommended"] });
  }
  return redoclyConfigPromise;
};

const resolveVisualizationInput = async (input) => {
  if (!input || typeof input !== "object") {
    throw Service.rejectResponse(
      {
        message: EMPTY_BODY_ERROR,
      },
      400,
    );
  }
  const { arazzoBody, arazzoUrl } = input;
  if (typeof arazzoBody === "string" && arazzoBody.trim().length > 0) {
    return {
      source: "request-body",
      contents: arazzoBody,
    };
  }
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
  const resolved = await resolveOasInput(input);
  const trimmed = typeof resolved.contents === "string" ? resolved.contents.trim() : "";
  if (!trimmed) {
    throw Service.rejectResponse(
      {
        message: EMPTY_BODY_ERROR,
      },
      400,
    );
  }
  return {
    source: resolved.source,
    contents: trimmed,
  };
};

const ensureTempFile = async (contents, filename = "input.yaml") => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  const filePath = path.join(tempDir, filename);
  await fs.writeFile(filePath, contents, "utf8");
  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  };
  return { filePath, cleanup };
};

const loadArazzoDocument = async (contents) => {
  const { filePath, cleanup } = await ensureTempFile(contents, "arazzo.yaml");
  try {
    const modulePath = path.resolve(
      "node_modules",
      "@redocly",
      "respect-core",
      "lib",
      "modules",
      "flow-runner",
      "get-test-description-from-file.js",
    );
    const { bundleArazzo } = await import(pathToFileURL(modulePath));
    const document = await bundleArazzo({
      filePath,
      base: path.dirname(filePath),
      externalRefResolver: undefined,
      collectSpecData: undefined,
      version: "don-tools-api",
      skipLint: true,
      logger: redoclyLogger,
    });
    if (!document || !document.workflows || document.workflows.length === 0) {
      throw new Error(INVALID_SPEC_ERROR);
    }
    return document;
  } catch (error) {
    appLogger.error("[ArazzoVisualizationService] bundelen mislukt", {
      message: error?.message,
      detail: error?.detail,
      stack: error?.stack,
    });
    throw error;
  } finally {
    await cleanup();
  }
};

const generateArazzoFromOpenApi = async (contents) => {
  const { filePath, cleanup } = await ensureTempFile(contents, "openapi.yaml");
  try {
    const { generate } = await import(
      pathToFileURL(path.resolve("node_modules", "@redocly", "respect-core", "lib", "generate.js"))
    );
    const config = await getRedoclyConfig();
    const document = await generate({
      descriptionPath: filePath,
      collectSpecData: undefined,
      version: "don-tools-api",
      config,
      base: path.dirname(filePath),
    });
    if (!document || !document.workflows || document.workflows.length === 0) {
      throw new Error(INVALID_SPEC_ERROR);
    }
    return document;
  } catch (error) {
    appLogger.error("[ArazzoVisualizationService] generate from OpenAPI failed", {
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

const normalizeText = (value) => {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const SOURCE_REF_PREFIX = "$sourceDescriptions.";
const COMPONENT_INPUTS_PREFIX = "#/components/inputs/";
const ALLOWED_METHODS = new Set(["get", "put", "post", "delete", "patch", "head", "options", "trace"]);

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

const buildOperationLookup = (openapiDocument) => {
  const lookup = new Map();
  if (!openapiDocument || typeof openapiDocument !== "object") {
    return lookup;
  }
  const paths = openapiDocument.paths;
  if (!paths || typeof paths !== "object") {
    return lookup;
  }
  Object.entries(paths).forEach(([pathKey, pathItem]) => {
    if (!pathItem || typeof pathItem !== "object") {
      return;
    }
    Object.entries(pathItem).forEach(([method, operation]) => {
      if (!ALLOWED_METHODS.has(method) || !operation || typeof operation !== "object") {
        return;
      }
      const operationId = operation.operationId;
      if (!operationId) {
        return;
      }
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
  if (!schema || typeof schema !== "object") {
    return "";
  }
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
    const details = [description, typeInfo ? `type: ${typeInfo}` : undefined].filter(Boolean).join(" | ");
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
  if (!inputs) {
    return [];
  }
  if (inputs.$ref && typeof inputs.$ref === "string") {
    if (!inputs.$ref.startsWith(COMPONENT_INPUTS_PREFIX)) {
      return [];
    }
    const refName = inputs.$ref.slice(COMPONENT_INPUTS_PREFIX.length);
    const definition = components?.[refName];
    if (!definition) {
      return [];
    }
    return [{ name: refName, schema: definition }];
  }
  if (typeof inputs === "object") {
    const inlineName = inputs.name || inputs.title || "inputs";
    return [{ name: inlineName, schema: inputs }];
  }
  return [];
};

const formatParameterValue = (value) => {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "onbekend";
  }
  return JSON.stringify(value);
};

const appendCriteriaLines = (lines, items, label) => {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }
  lines.push(`  - ${label}:`);
  items.forEach((criteria) => {
    const condition = normalizeText(criteria?.condition) || "(geen conditie)";
    const detail = normalizeText(criteria?.description);
    lines.push(`    - ${condition}${detail ? ` — ${detail}` : ""}`);
  });
};

const appendOutputs = (lines, outputs) => {
  if (!outputs || typeof outputs !== "object" || Object.keys(outputs).length === 0) {
    return;
  }
  lines.push("  - Outputs:");
  Object.entries(outputs).forEach(([key, value]) => {
    lines.push(`    - ${key}: ${JSON.stringify(value)}`);
  });
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

const buildMarkdown = (document, options = {}) => {
  const lines = [];
  const title = normalizeText(document.info?.title) || "Arazzo Workflows";
  const description = normalizeText(document.info?.description);
  const operationLookup = buildOperationLookup(options.openapi);
  lines.push(`# ${title}`);
  if (description) {
    lines.push("", description);
  }
  document.workflows.forEach((workflow, workflowIndex) => {
    const workflowTitle = normalizeText(workflow.summary) || workflow.workflowId || `Workflow ${workflowIndex + 1}`;
    lines.push("", `## ${workflowTitle}`);
    if (workflow.description) {
      lines.push("", workflow.description.trim());
    }
    const inputs = resolveInputs(workflow.inputs, document.components?.inputs);
    if (inputs.length > 0) {
      lines.push("", "### Inputs");
      inputs.forEach((input) => {
        formatInputDefinition(input.name, input.schema).forEach((line) => {
          lines.push(line);
        });
      });
    }
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
    if (Array.isArray(workflow.steps) && workflow.steps.length > 0) {
      lines.push("", "### Stappen");
      workflow.steps.forEach((step, index) => {
        const stepLabel = step.stepId || `Stap ${index + 1}`;
        const { operationDetails, suffix } = describeStepOperation(step, operationLookup);
        lines.push(`- **${stepLabel}${suffix}**`);
        const summary = operationDetails?.summary;
        const description = operationDetails?.description;
        if (summary) {
          lines.push(`  - ${summary}`);
        }
        if (description && description !== summary) {
          lines.push(`  - ${description}`);
        }
        const stepDescription = normalizeText(step.description);
        if (stepDescription && stepDescription !== summary && stepDescription !== description) {
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

const escapeMermaidLabel = (value) => {
  if (!value) {
    return "";
  }
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
  document.workflows.forEach((workflow, workflowIndex) => {
    const workflowTitle = normalizeText(workflow.summary) || workflow.workflowId || `Workflow ${workflowIndex + 1}`;
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

const visualize = async (input) => {
  const resolved = await resolveVisualizationInput(input);
  if (!resolved.contents) {
    throw Service.rejectResponse(
      {
        message: EMPTY_BODY_ERROR,
      },
      400,
    );
  }
  let document;
  let parsed;
  try {
    parsed = jsYaml.load(resolved.contents);
  } catch {
    parsed = undefined;
  }
  const isObject = parsed && typeof parsed === "object" && !Array.isArray(parsed);
  const isArazzoSpecification = Boolean(isObject && parsed.arazzo);
  const openapiDocument = isObject && !isArazzoSpecification ? parsed : undefined;
  try {
    if (isArazzoSpecification) {
      document = await loadArazzoDocument(resolved.contents);
    } else {
      document = await generateArazzoFromOpenApi(resolved.contents);
    }
  } catch (error) {
    if (Service.isErrorResponse(error)) {
      throw error;
    }
    appLogger.error("[ArazzoVisualizationService] visualiseren mislukt", {
      message: error?.message,
      detail: error?.detail,
      stack: error?.stack,
    });
    throw Service.rejectResponse(
      {
        message: error?.message && error.message !== "Unknown error" ? error.message : INVALID_SPEC_ERROR,
        detail: error.message,
      },
      400,
    );
  }
  return {
    markdown: buildMarkdown(document, { openapi: openapiDocument }),
    mermaid: buildMermaid(document, { openapi: openapiDocument }),
  };
};

module.exports = {
  visualize,
};
