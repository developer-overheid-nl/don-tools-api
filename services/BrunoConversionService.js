const jsYaml = require("js-yaml");
const { openApiToBruno } = require("@usebruno/converters");
const { jsonToBruV2, jsonToCollectionBru, envJsonToBruV2 } = require("@usebruno/lang");
const Service = require("./Service");
const { resolveOasInput } = require("./OasInputService");
const { createZipFromEntries } = require("./ZipService");
const { sanitizeFileName } = require("../utils/fileName");

const EMPTY_BODY_ERROR = "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody";
const DEFAULT_COLLECTION_NAME = "bruno-collection";
const DEFAULT_CONFIG_IGNORE = ["node_modules", ".git"];
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

const parseSpecification = (contents) => {
  const trimmed = typeof contents === "string" ? contents.trim() : "";
  if (!trimmed) {
    throw Service.rejectResponse({ message: EMPTY_BODY_ERROR }, 400);
  }
  try {
    return JSON.parse(trimmed);
  } catch (_jsonError) {
    try {
      return jsYaml.load(trimmed);
    } catch (yamlError) {
      throw Service.rejectResponse(
        {
          message: `Kan OpenAPI document niet parsen: ${yamlError.message}`,
        },
        400,
      );
    }
  }
};

const ensureSecuritySchemes = (spec) => {
  if (!spec || typeof spec !== "object") {
    return spec;
  }

  const neededSchemes = new Set();
  const collectFromArray = (securityArray) => {
    if (!Array.isArray(securityArray)) {
      return;
    }
    securityArray.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      Object.keys(entry).forEach((name) => {
        if (typeof name === "string" && name.trim().length > 0) {
          neededSchemes.add(name);
        }
      });
    });
  };

  collectFromArray(spec.security);
  const paths = spec.paths && typeof spec.paths === "object" ? spec.paths : {};
  Object.values(paths).forEach((pathItem) => {
    if (!pathItem || typeof pathItem !== "object") {
      return;
    }
    Object.entries(pathItem).forEach(([method, operation]) => {
      if (!HTTP_METHODS.has(String(method).toLowerCase())) {
        return;
      }
      collectFromArray(operation?.security);
    });
  });

  if (neededSchemes.size === 0) {
    return spec;
  }

  if (!spec.components || typeof spec.components !== "object") {
    spec.components = {};
  }
  if (!spec.components.securitySchemes || typeof spec.components.securitySchemes !== "object") {
    spec.components.securitySchemes = {};
  }

  const schemes = spec.components.securitySchemes;
  neededSchemes.forEach((name) => {
    if (Object.hasOwn(schemes, name)) {
      return;
    }
    const lower = name.toLowerCase();
    if (lower.includes("key")) {
      schemes[name] = {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      };
    } else if (lower.includes("basic")) {
      schemes[name] = {
        type: "http",
        scheme: "basic",
      };
    } else if (lower.includes("bearer") || lower.includes("token")) {
      schemes[name] = {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      };
    } else {
      schemes[name] = {
        type: "oauth2",
        flows: {
          clientCredentials: {
            tokenUrl: "https://example.com/oauth/token",
            scopes: {},
          },
        },
      };
    }
  });

  return spec;
};

const buildFileEntriesFromCollection = (collection) => {
  const collectionName = sanitizeFileName(collection?.name, { fallback: DEFAULT_COLLECTION_NAME });
  const entries = [];
  const rootDir = collectionName;

  const brunoConfig = collection.brunoConfig || {
    version: "1",
    name: collection?.name || collectionName,
    type: "collection",
    ignore: DEFAULT_CONFIG_IGNORE,
  };

  entries.push({
    path: `${rootDir}/bruno.json`,
    contents: `${JSON.stringify(brunoConfig, null, 2)}\n`,
  });

  const collectionBru = jsonToCollectionBru(collection.root || {});
  entries.push({
    path: `${rootDir}/collection.bru`,
    contents: collectionBru.endsWith("\n") ? collectionBru : `${collectionBru}\n`,
  });

  const writeItems = (items, currentPath) => {
    if (!Array.isArray(items)) {
      return;
    }
    items.forEach((item, index) => {
      if (!item || typeof item !== "object") {
        return;
      }
      if (item.type === "folder") {
        const folderName = sanitizeFileName(item.name, { fallback: `folder-${index + 1}` });
        const folderPath = `${currentPath}/${folderName}`;
        const folderBru = jsonToCollectionBru(item.root || {});
        entries.push({
          path: `${folderPath}/folder.bru`,
          contents: folderBru.endsWith("\n") ? folderBru : `${folderBru}\n`,
        });
        writeItems(item.items, folderPath);
      } else if (item.type === "http-request" || item.type === "graphql-request") {
        const fileName = sanitizeFileName(item.name, { fallback: `request-${index + 1}` });
        const bruContent = jsonToBruV2(item);
        entries.push({
          path: `${currentPath}/${fileName}.bru`,
          contents: bruContent.endsWith("\n") ? bruContent : `${bruContent}\n`,
        });
      } else if (item.type === "js") {
        const scriptName = sanitizeFileName(item.name, { fallback: `script-${index + 1}` });
        entries.push({
          path: `${currentPath}/${scriptName}.js`,
          contents: item.fileContent || "",
        });
      }
    });
  };

  writeItems(collection.items, rootDir);

  if (Array.isArray(collection.environments) && collection.environments.length > 0) {
    const envDir = `${rootDir}/environments`;
    collection.environments.forEach((env, index) => {
      const envName = sanitizeFileName(env?.name, { fallback: `environment-${index + 1}` });
      const envBru = envJsonToBruV2(env || {});
      entries.push({
        path: `${envDir}/${envName}.bru`,
        contents: envBru.endsWith("\n") ? envBru : `${envBru}\n`,
      });
    });
  }

  return { entries, collectionName };
};

const convert = async (input) => {
  let resolved;
  try {
    resolved = await resolveOasInput(input);
  } catch (error) {
    if (Service.isErrorResponse(error)) {
      throw error;
    }
    throw Service.rejectResponse(
      {
        message: error.message || "Er is een fout opgetreden tijdens het lezen van de input.",
      },
      500,
    );
  }

  let specification;
  try {
    specification = parseSpecification(resolved.contents);
  } catch (error) {
    if (Service.isErrorResponse(error)) {
      throw error;
    }
    throw error;
  }

  const sanitizedSpec = ensureSecuritySchemes(specification);

  let brunoCollection;
  try {
    brunoCollection = openApiToBruno(sanitizedSpec);
  } catch (error) {
    throw Service.rejectResponse(
      {
        message: error.message || "Conversie naar Bruno is mislukt.",
      },
      500,
    );
  }

  const { entries, collectionName } = buildFileEntriesFromCollection(brunoCollection);

  let archive;
  try {
    archive = await createZipFromEntries(entries);
  } catch (error) {
    throw Service.rejectResponse(
      {
        message: error.message || "Kon het Bruno archief niet genereren.",
      },
      500,
    );
  }

  return {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${collectionName}.zip"`,
    },
    rawBody: archive,
  };
};

module.exports = {
  convert,
};
