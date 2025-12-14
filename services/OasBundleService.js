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

const escapeJsonPointer = (segment) => segment.replace(/~/g, "~0").replace(/\//g, "~1");

const buildJsonPointer = (path) => {
  if (!Array.isArray(path) || path.length === 0) {
    return "#/";
  }
  return `#/${path.map((part) => escapeJsonPointer(String(part))).join("/")}`;
};

const findComponentPointer = (path) => {
  if (!Array.isArray(path)) {
    return null;
  }
  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i];
    if (segment === "components" && typeof path[i + 1] === "string" && typeof path[i + 2] === "string") {
      return `#/components/${escapeJsonPointer(path[i + 1])}/${escapeJsonPointer(path[i + 2])}`;
    }
    if (segment === "definitions" && typeof path[i + 1] === "string") {
      return `#/definitions/${escapeJsonPointer(path[i + 1])}`;
    }
  }
  return null;
};

const decycleDocument = (value) => {
  const stack = new WeakSet();
  const pointers = new WeakMap();
  const componentPointers = new WeakMap();
  const bubbleKeys = new Set(["properties"]);

  const visit = (node, path, parentKey) => {
    if (!node || typeof node !== "object") {
      return node;
    }
    const existingPointer = pointers.get(node);
    if (stack.has(node)) {
      const preferredRef = componentPointers.get(node) || existingPointer || buildJsonPointer(path);
      return { __circularRef: preferredRef, __bubble: bubbleKeys.has(parentKey) };
    }

    const pointer = existingPointer || buildJsonPointer(path);
    pointers.set(node, pointer);
    const componentPointer = componentPointers.get(node) || findComponentPointer(path);
    if (componentPointer) {
      componentPointers.set(node, componentPointer);
    }
    stack.add(node);

    if (Array.isArray(node)) {
      const copy = node.map((item, index) => visit(item, [...path, index], index.toString()));
      const bubbleEntry = copy.find((entry) => entry && entry.__circularRef && entry.__bubble);
      stack.delete(node);
      if (bubbleEntry) {
        return { $ref: bubbleEntry.__circularRef };
      }
      return copy.map((entry) => (entry && entry.__circularRef ? { $ref: entry.__circularRef } : entry));
    }

    const copy = {};
    let bubbleRef;
    Object.entries(node).forEach(([key, child]) => {
      const processed = visit(child, [...path, key], key);
      if (processed && processed.__circularRef) {
        if (processed.__bubble) {
          bubbleRef = processed.__circularRef;
        } else {
          copy[key] = { $ref: processed.__circularRef };
        }
      } else {
        copy[key] = processed;
      }
    });
    stack.delete(node);
    if (bubbleRef) {
      return { $ref: bubbleRef };
    }
    return copy;
  };

  return visit(value, [], "");
};

const convertToPreferredFormat = (doc, preferredExt, baseName) => {
  const serializableDoc = decycleDocument(doc);
  const targetName = baseName && baseName.length > 0 ? baseName : DEFAULT_FILENAME;
  if ([".yaml", ".yml"].includes(String(preferredExt).toLowerCase())) {
    const yaml = jsYaml.dump(serializableDoc, { lineWidth: -1 });
    return {
      buffer: Buffer.from(yaml, "utf8"),
      filename: `${targetName}.yaml`,
      contentType: "application/yaml",
    };
  }
  const json = JSON.stringify(serializableDoc, null, 2);
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
