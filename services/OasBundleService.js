const path = require("node:path");
const { URL } = require("node:url");
const jsYaml = require("js-yaml");
const { bundleFromString, createConfig } = require("@redocly/openapi-core");
const Service = require("./Service");
const { resolveOasInput } = require("./OasInputService");
const { sanitizeFileName } = require("../utils/fileName");
const logger = require("../logger");

const DEFAULT_FILENAME = "openapi";

const guessPreferredExtension = (contents) => {
  if (typeof contents !== "string") {
    return ".json";
  }
  const trimmed = contents.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return ".json";
  }
  return ".yaml";
};

const deriveDocumentName = (doc, source) => {
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const infoTitle = typeof doc.info?.title === "string" ? doc.info.title.trim() : "";
    if (infoTitle) {
      const sanitized = sanitizeFileName(infoTitle, { fallback: DEFAULT_FILENAME });
      if (sanitized) {
        return sanitized;
      }
    }
  }
  if (typeof source === "string" && source !== "request-body") {
    try {
      const parsed = new URL(source);
      const basePath = parsed.pathname || "";
      if (basePath) {
        const basename = path.posix.basename(basePath);
        const withoutExt = basename.replace(/\.[^.]+$/, "");
        const sanitized = sanitizeFileName(withoutExt, { fallback: DEFAULT_FILENAME });
        if (sanitized) {
          return sanitized;
        }
      }
    } catch {
      // ignore invalid URL
    }
  }
  return DEFAULT_FILENAME;
};

const convertToPreferredFormat = (doc, preferredExt, baseName) => {
  const targetName = baseName && baseName.length > 0 ? baseName : DEFAULT_FILENAME;
  if ([".yaml", ".yml"].includes(String(preferredExt).toLowerCase())) {
    const yaml = jsYaml.dump(doc, { lineWidth: -1 });
    return {
      buffer: Buffer.from(yaml, "utf8"),
      filename: `${targetName}.yaml`,
      contentType: "application/yaml",
    };
  }
  const json = JSON.stringify(doc, null, 2);
  return {
    buffer: Buffer.from(json, "utf8"),
    filename: `${targetName}.json`,
    contentType: "application/json",
  };
};

let configPromise;
const getRedoclyConfig = () => {
  if (!configPromise) {
    configPromise = createConfig({ extends: ["recommended"] });
  }
  return configPromise;
};

const normalizeAbsoluteRef = (source) => {
  if (typeof source !== "string" || source === "request-body") {
    return undefined;
  }
  try {
    return new URL(source).toString();
  } catch {
    return undefined;
  }
};

const bundle = async (input) => {
  const resolved = await resolveOasInput(input);
  const contents = typeof resolved.contents === "string" ? resolved.contents : "";
  if (!contents.trim()) {
    throw Service.rejectResponse(
      {
        message: "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody.",
      },
      400,
    );
  }

  const config = await getRedoclyConfig();
  let bundled;
  try {
    bundled = await bundleFromString({
      source: contents,
      absoluteRef: normalizeAbsoluteRef(resolved.source),
      config,
      dereference: true,
      keepUrlRefs: false,
    });
  } catch (error) {
    logger.error("[OasBundleService] bundle failed", {
      message: error?.message,
      detail: error?.detail,
      stack: error?.stack,
    });
    const status = typeof error?.status === "number" && error.status >= 400 ? error.status : 400;
    throw Service.rejectResponse(
      {
        message: "Het bundelen van de OpenAPI specificatie is mislukt.",
        detail: error?.message,
      },
      status,
    );
  }

  const document = bundled?.bundle?.parsed;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw Service.rejectResponse(
      {
        message: "Onverwachte structuur na bundelen.",
      },
      500,
    );
  }

  if (Array.isArray(bundled?.problems) && bundled.problems.length > 0) {
    logger.warn("[OasBundleService] bundle reported problems", {
      problems: bundled.problems.slice(0, 5),
    });
  }

  const preferredExt = guessPreferredExtension(contents);
  const docName = deriveDocumentName(document, resolved.source);
  const { buffer, filename, contentType } = convertToPreferredFormat(document, preferredExt, docName);

  return {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    rawBody: buffer,
  };
};

module.exports = {
  bundle,
};
