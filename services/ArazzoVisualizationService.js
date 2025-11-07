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

const buildMarkdown = (document) => {
  const lines = [];
  const title = normalizeText(document.info?.title) || "Arazzo Workflows";
  const description = normalizeText(document.info?.description);
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
    if (Array.isArray(workflow.steps) && workflow.steps.length > 0) {
      lines.push("", "### Stappen");
      workflow.steps.forEach((step, index) => {
        const stepLabel = step.stepId || `Stap ${index + 1}`;
        const operation = step.operationId ? ` (${step.operationId})` : "";
        lines.push(`- **${stepLabel}${operation}**`);
        if (step.description) {
          lines.push(`  - ${step.description.trim()}`);
        }
        const outputs = step.outputs;
        if (outputs && typeof outputs === "object" && Object.keys(outputs).length > 0) {
          lines.push("  - Outputs:");
          Object.entries(outputs).forEach(([key, value]) => {
            lines.push(`    - ${key}: ${JSON.stringify(value)}`);
          });
        }
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

const buildMermaidForWorkflow = (workflow) => {
  const lines = ["flowchart TD"];
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  if (steps.length === 0) {
    lines.push('    EmptyWorkflow["Geen stappen gedefinieerd"]');
    return lines.join("\n");
  }
  const nodeIds = steps.map((step, index) => {
    const workflowKey = workflow.workflowId || `wf${Math.max(index, 1)}`;
    return `${workflowKey}_${step.stepId || index + 1}`.replace(/[^a-zA-Z0-9_]/g, "_");
  });
  steps.forEach((step, index) => {
    const label =
      escapeMermaidLabel(step.stepId || `Stap ${index + 1}`) +
      (step.operationId ? ` (${escapeMermaidLabel(step.operationId)})` : "");
    lines.push(`    ${nodeIds[index]}["${label}"]`);
  });
  for (let i = 0; i < nodeIds.length - 1; i += 1) {
    lines.push(`    ${nodeIds[i]} --> ${nodeIds[i + 1]}`);
  }
  return lines.join("\n");
};

const buildMermaid = (document) => {
  return document.workflows.map((workflow) => buildMermaidForWorkflow(workflow)).join("\n\n");
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
  try {
    let parsed;
    try {
      parsed = jsYaml.load(resolved.contents);
    } catch {
      parsed = undefined;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.arazzo) {
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
    markdown: buildMarkdown(document),
    mermaid: buildMermaid(document),
  };
};

module.exports = {
  visualize,
};
