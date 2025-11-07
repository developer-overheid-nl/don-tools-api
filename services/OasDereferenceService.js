const path = require("node:path");
const { URL } = require("node:url");
const jsYaml = require("js-yaml");
const { fetch } = require("@stoplight/spectral-runtime");
const Service = require("./Service");
const { resolveOasInput } = require("./OasInputService");
const logger = require("../logger");
const { sanitizeFileName } = require("../utils/fileName");

const ROOT_KEY = "__root__";
const REQUEST_TIMEOUT_MS = 2000;

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

const deriveDocumentName = (doc, baseUrl) => {
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const info = doc.info;
    if (info && typeof info === "object") {
      const title = typeof info.title === "string" ? info.title.trim() : "";
      if (title.length > 0) {
        const sanitized = sanitizeFileName(title);
        if (sanitized.length > 0) {
          return sanitized;
        }
      }
    }
  }
  if (baseUrl instanceof URL) {
    const basePath = baseUrl.pathname || "";
    if (basePath.length > 0) {
      const basename = path.posix.basename(basePath);
      const withoutExt = basename.replace(/\.[^.]+$/, "");
      const sanitized = sanitizeFileName(withoutExt);
      if (sanitized.length > 0) {
        return sanitized;
      }
    }
  }
  return "openapi";
};

const convertToPreferredFormat = (doc, preferredExt, baseName) => {
  const targetName = baseName && baseName.length > 0 ? baseName : "openapi";
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

const normalizeYaml = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeYaml(item));
  }
  if (value && typeof value === "object") {
    const normalized = {};
    Object.entries(value).forEach(([key, val]) => {
      normalized[String(key)] = normalizeYaml(val);
    });
    return normalized;
  }
  return value;
};

const deepCopy = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => deepCopy(item));
  }
  if (value && typeof value === "object") {
    const copied = {};
    Object.entries(value).forEach(([key, val]) => {
      copied[key] = deepCopy(val);
    });
    return copied;
  }
  return value;
};

const jsonPointerLookup = (doc, pointer) => {
  if (!pointer) {
    return doc;
  }
  const segments = pointer.split("/");
  let current = doc;
  for (const segment of segments) {
    if (segment === "") {
      continue;
    }
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = Number.parseInt(key, 10);
      if (Number.isNaN(index) || index < 0 || index >= current.length) {
        throw new Error(`pad '${pointer}' bevat ongeldige index`);
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") {
      throw new Error(`pad '${pointer}' verwijst naar ongeldige structuur`);
    }
    if (!Object.hasOwn(current, key)) {
      throw new Error(`pad '${pointer}' niet gevonden`);
    }
    current = current[key];
  }
  return current;
};

const fetchWithTimeout = async (url) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Server gaf status ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    if (error.name === "AbortError") {
      logger.error(`[OasDereferenceService] fetch timeout for ${url}: ${error.message}`);
      throw new Error("Timeout tijdens ophalen van document");
    }
    logger.error(
      `[OasDereferenceService] fetch failed for ${url}: ${error.message}${error.stack ? ` stack=${error.stack}` : ""}`,
    );
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

class RefResolver {
  constructor() {
    this.docs = new Map();
    this.resolving = new Set();
  }

  setDocument(key, doc) {
    this.docs.set(key, doc);
  }

  async resolveNode(node, docKey, baseUrl) {
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        // eslint-disable-next-line no-param-reassign
        node[index] = await this.resolveNode(node[index], docKey, baseUrl);
      }
      return node;
    }
    if (!node || typeof node !== "object") {
      return node;
    }
    if (typeof node.$ref === "string" && node.$ref.trim().length > 0) {
      const refValue = node.$ref.trim();
      const { resolved, targetKey, targetBase } = await this.resolveRef(refValue, docKey, baseUrl);
      delete node.$ref;
      if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
        Object.entries(resolved).forEach(([key, value]) => {
          // eslint-disable-next-line no-param-reassign
          node[key] = value;
        });
        return this.resolveNode(node, targetKey, targetBase);
      }
      if (Object.keys(node).length === 0) {
        return resolved;
      }
      // eslint-disable-next-line no-param-reassign
      node.value = resolved;
      return this.resolveNode(node, targetKey, targetBase);
    }
    for (const [key, value] of Object.entries(node)) {
      // eslint-disable-next-line no-param-reassign
      node[key] = await this.resolveNode(value, docKey, baseUrl);
    }
    return node;
  }

  async resolveRef(ref, docKey, baseUrl) {
    let fragment = "";
    let targetUrl;
    let targetKey = docKey;
    let targetBase = baseUrl;
    if (ref.startsWith("#")) {
      fragment = ref;
    } else {
      try {
        const base = baseUrl instanceof URL ? baseUrl : undefined;
        const parsed = base ? new URL(ref, base) : new URL(ref);
        fragment = parsed.hash || "";
        parsed.hash = "";
        if (parsed.href.length > 0) {
          targetKey = parsed.href;
          targetBase = parsed;
        }
        targetUrl = parsed;
      } catch (error) {
        throw Service.rejectResponse(
          {
            message: `Ongeldige $ref '${ref}': ${error.message}`,
          },
          500,
        );
      }
    }

    const document = await this.getDocument(targetKey, targetUrl);
    let value = document;
    if (fragment && fragment.length > 0) {
      const pointer = fragment.startsWith("#") ? fragment.slice(1) : fragment;
      try {
        value = jsonPointerLookup(document, pointer);
      } catch (error) {
        throw Service.rejectResponse(
          {
            message: `Kon fragment '${fragment}' niet vinden: ${error.message}`,
          },
          500,
        );
      }
    }
    const copy = deepCopy(value);
    const resolved = await this.resolveNode(copy, targetKey, targetBase);
    return { resolved, targetKey, targetBase };
  }

  async getDocument(key, url) {
    if (this.docs.has(key)) {
      return this.docs.get(key);
    }
    if (!url || !(url instanceof URL) || url.href.length === 0) {
      throw Service.rejectResponse(
        {
          message: "Kan $ref niet oplossen zonder basis URL",
        },
        500,
      );
    }
    if (this.resolving.has(key)) {
      if (this.docs.has(key)) {
        return this.docs.get(key);
      }
    }
    this.resolving.add(key);
    try {
      const contents = await fetchWithTimeout(url.toString());
      let parsed;
      try {
        parsed = jsYaml.load(contents);
      } catch (error) {
        throw Service.rejectResponse(
          {
            message: `Kon externe referentie ${url.toString()} niet parsen: ${error.message}`,
          },
          500,
        );
      }
      const normalized = normalizeYaml(parsed);
      if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
        throw Service.rejectResponse(
          {
            message: `Externe referentie ${url.toString()} bevat geen object`,
          },
          500,
        );
      }
      this.docs.set(key, normalized);
      await this.resolveNode(normalized, key, url);
      return normalized;
    } finally {
      this.resolving.delete(key);
    }
  }
}

const dereference = async (input) => {
  let specInput;
  try {
    specInput = await resolveOasInput(input);
  } catch (error) {
    logger.error("[OasDereferenceService] resolveOasInput failed", { message: error.message, stack: error.stack });
    if (Service.isErrorResponse(error)) {
      throw error;
    }
    throw Service.rejectResponse(
      {
        message: error.message || "Onbekende fout bij het uitlezen van de input.",
      },
      500,
    );
  }

  const { contents, source } = specInput;
  const trimmed = contents.trim();
  if (trimmed.length === 0) {
    throw Service.rejectResponse(
      {
        message: "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody",
      },
      400,
    );
  }

  let rawDocument;
  try {
    rawDocument = jsYaml.load(contents);
  } catch (error) {
    logger.error("[OasDereferenceService] parsing failed", { message: error.message, stack: error.stack });
    throw Service.rejectResponse(
      {
        message: `Kon OpenAPI document niet parsen: ${error.message}`,
      },
      500,
    );
  }

  const normalized = normalizeYaml(rawDocument);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw Service.rejectResponse(
      {
        message: "Verwacht een object als root van het OpenAPI document",
      },
      500,
    );
  }

  const resolver = new RefResolver();
  resolver.setDocument(ROOT_KEY, normalized);

  let baseUrl;
  if (typeof source === "string" && source.length > 0 && source !== "request-body") {
    try {
      const parsed = new URL(source);
      if (parsed.protocol && parsed.host) {
        baseUrl = parsed;
      }
    } catch {
      baseUrl = undefined;
    }
  }

  const resolved = await resolver.resolveNode(normalized, ROOT_KEY, baseUrl);
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw Service.rejectResponse(
      {
        message: "Onverwachte structuur na dereferencing",
      },
      500,
    );
  }

  const docName = deriveDocumentName(resolved, baseUrl);
  const preferredExt = guessPreferredExtension(contents);
  const { buffer, filename, contentType } = convertToPreferredFormat(resolved, preferredExt, docName);

  return {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    rawBody: buffer,
  };
};

module.exports = {
  dereference,
};
