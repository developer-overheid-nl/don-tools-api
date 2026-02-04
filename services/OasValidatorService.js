const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const spectralFunctions = require("@stoplight/spectral-functions");
const jsYaml = require("js-yaml");
const { Spectral, Document, Ruleset } = require("@stoplight/spectral-core");
const Parsers = require("@stoplight/spectral-parsers");
const { oas: oasRuleset } = require("@stoplight/spectral-rulesets");
const Service = require("./Service");
const { fetchSpecification } = require("./RemoteSpecificationService");
const logger = require("../logger");

const RULESET_FILES = {
  "2.0": path.join(__dirname, "..", "rulesets", "ruleset_2.0.yaml"),
  2.1: path.join(__dirname, "..", "rulesets", "ruleset_2.1.yaml"),
};
const DEFAULT_RULESET_VERSION = "2.0";

const SEVERITY_LABELS = ["error", "warning", "info", "hint"];

const MEASURED_RULE_GROUPS = {
  openapi3: "openapi3",
  "openapi-root-exists": "openapi-root-exists",
  "missing-version-header": "version-header",
  "missing-header": "version-header",
  "include-major-version-in-uri": "include-major-version-in-uri",
  "paths-no-trailing-slash": "paths-no-trailing-slash",
  "info-contact-fields-exist": "info-contact-fields-exist",
  "http-methods": "http-methods",
  semver: "semver",
};

const MEASURED_GROUP_KEYS = Array.from(new Set(Object.values(MEASURED_RULE_GROUPS)));

const spectralInstancePromises = new Map();

const resolveRulesetExtendsEntry = (entry) => {
  if (Array.isArray(entry)) {
    if (entry.length === 0) {
      return entry;
    }
    const [target, severity, ...rest] = entry;
    if (rest.length > 0) {
      throw new Error(`Onbekende extends configuratie in ruleset: ${JSON.stringify(entry)}`);
    }
    return [resolveRulesetExtendsEntry(target), severity];
  }
  if (typeof entry === "string") {
    if (entry === "spectral:oas") {
      return oasRuleset;
    }
    throw new Error(`Onbekende ruleset referentie '${entry}'`);
  }
  return entry;
};

const getRulesetPath = (version) => {
  if (Object.hasOwn(RULESET_FILES, version)) {
    return RULESET_FILES[version];
  }
  return RULESET_FILES[DEFAULT_RULESET_VERSION];
};

const loadRulesetDefinition = async (rulesetPath) => {
  try {
    const contents = await fs.readFile(rulesetPath, "utf8");
    const definition = jsYaml.load(contents);
    if (!definition || typeof definition !== "object") {
      throw new Error("Ruleset-bestand is leeg of ongeldig.");
    }
    if (definition.extends) {
      const normalizedExtends = Array.isArray(definition.extends)
        ? definition.extends.map(resolveRulesetExtendsEntry)
        : resolveRulesetExtendsEntry(definition.extends);
      definition.extends = normalizedExtends;
    }
    if (definition.rules) {
      Object.values(definition.rules).forEach((rule) => {
        if (!rule || typeof rule !== "object") {
          return;
        }
        const thens = Array.isArray(rule.then) ? rule.then : [rule.then];
        thens.forEach((thenEntry) => {
          if (!thenEntry || typeof thenEntry !== "object") {
            return;
          }
          if (typeof thenEntry.function === "string") {
            const fnName = thenEntry.function;
            const fn = spectralFunctions[fnName];
            if (typeof fn !== "function") {
              throw new Error(`Onbekende Spectral-functie '${fnName}' in ruleset.`);
            }
            thenEntry.function = fn;
          }
        });
      });
    }
    return definition;
  } catch (error) {
    logger.error("[OasValidatorService] loadRulesetDefinition failed", {
      message: error.message,
      stack: error.stack,
    });
    throw new Error(error.message || "Onbekende fout bij het laden van het ruleset-bestand.");
  }
};

const loadSpectral = async (rulesetVersion) => {
  if (!spectralInstancePromises.has(rulesetVersion)) {
    const promise = (async () => {
      try {
        const rulesetPath = getRulesetPath(rulesetVersion);
        const spectral = new Spectral();
        const rulesetDefinition = await loadRulesetDefinition(rulesetPath);
        const ruleset = new Ruleset(rulesetDefinition, {
          severity: "recommended",
          source: rulesetPath,
        });
        spectral.setRuleset(ruleset);
        return spectral;
      } catch (error) {
        logger.error(`[OasValidatorService] Unable to load Spectral ruleset (${rulesetVersion}): ${error.message}`);
        spectralInstancePromises.delete(rulesetVersion);
        throw Service.rejectResponse(
          {
            message: "Kan het regels-bestand niet laden voor validatie.",
            detail: error.message,
          },
          500,
        );
      }
    })();
    spectralInstancePromises.set(rulesetVersion, promise);
  }
  return spectralInstancePromises.get(rulesetVersion);
};

const resolveSpecificationInput = async (input) => {
  if (!input || typeof input !== "object") {
    throw Service.rejectResponse(
      {
        message: "Body ontbreekt of heeft een ongeldig formaat.",
      },
      400,
    );
  }
  const { oasBody, oasUrl } = input;
  if (typeof oasBody === "string" && oasBody.trim().length > 0) {
    return {
      source: "request-body",
      contents: oasBody,
    };
  }
  if (typeof oasUrl === "string" && oasUrl.trim().length > 0) {
    let parsedUrl;
    try {
      parsedUrl = new URL(oasUrl);
    } catch (error) {
      logger.error("[OasValidatorService] invalid oasUrl", { message: error.message });
      throw Service.rejectResponse(
        {
          message: "De waarde van oasUrl is geen geldige URL.",
        },
        400,
      );
    }
    const contents = await fetchSpecification(parsedUrl.toString(), {
      errorMessage: "Het ophalen van de OpenAPI specificatie is mislukt.",
    });
    return {
      source: parsedUrl.toString(),
      contents,
    };
  }
  throw Service.rejectResponse(
    {
      message: "Geef een oasBody of oasUrl mee.",
    },
    400,
  );
};

const buildInfo = (lintMessageId, diagnostic) => {
  const pathValue =
    Array.isArray(diagnostic.path) && diagnostic.path.length > 0 ? diagnostic.path.map(String).join(".") : "body";
  return [
    {
      id: randomUUID(),
      lintMessageId,
      message: diagnostic.message,
      path: pathValue,
    },
  ];
};

const mapDiagnosticsToMessages = (diagnostics, timestamp) =>
  diagnostics.map((diagnostic) => {
    const lintMessageId = randomUUID();
    const severityIndex = typeof diagnostic.severity === "number" && diagnostic.severity >= 0 ? diagnostic.severity : 2;
    const severity = SEVERITY_LABELS[severityIndex] || "info";
    return {
      id: lintMessageId,
      code: diagnostic.code ? String(diagnostic.code) : "spectral",
      createdAt: timestamp,
      severity,
      infos: buildInfo(lintMessageId, diagnostic),
    };
  });

const computeAdrScore = (messages) => {
  const failedGroups = new Set();
  messages.forEach((message) => {
    if (String(message.severity).toLowerCase() !== "error") {
      return;
    }
    const group = MEASURED_RULE_GROUPS[message.code];
    if (group) {
      failedGroups.add(group);
    }
  });

  if (MEASURED_GROUP_KEYS.length === 0) {
    return { score: 100, failedGroups: [] };
  }

  const score = Math.round((1 - failedGroups.size / MEASURED_GROUP_KEYS.length) * 100);
  return {
    score: Math.max(0, Math.min(100, score)),
    failedGroups: Array.from(failedGroups).sort(),
  };
};

const buildLintResult = (diagnostics, rulesetVersion) => {
  const timestamp = new Date().toISOString();
  const messages = mapDiagnosticsToMessages(diagnostics, timestamp);
  const errorCount = messages.filter((message) => String(message.severity).toLowerCase() === "error").length;
  const { score } = computeAdrScore(messages);
  return {
    id: randomUUID(),
    apiId: "",
    createdAt: timestamp,
    failures: errorCount,
    messages,
    score,
    successes: score === 100,
    rulesetVersion,
  };
};

const normalizeRulesetVersion = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    value = value.toString();
  }
  if (typeof value !== "string") {
    return DEFAULT_RULESET_VERSION;
  }
  const trimmed = value.trim();
  if (trimmed === "2") {
    return "2.0";
  }
  if (Object.hasOwn(RULESET_FILES, trimmed)) {
    return trimmed;
  }
  return DEFAULT_RULESET_VERSION;
};

const resolveValidationSettings = (input) => ({
  rulesetVersion: normalizeRulesetVersion(input?.targetVersion),
});

const validate = async (input) => {
  const { contents, source } = await resolveSpecificationInput(input);
  const { rulesetVersion } = resolveValidationSettings(input);
  const spectral = await loadSpectral(rulesetVersion);
  const document = new Document(contents, Parsers.Yaml, source);
  const parseDiagnostics = Array.isArray(document.diagnostics) ? document.diagnostics : [];
  const lintDiagnostics = await spectral.run(document, { ignoreUnknownFormat: false });
  const diagnostics = [...parseDiagnostics, ...lintDiagnostics];
  return buildLintResult(diagnostics, rulesetVersion);
};

module.exports = {
  validate,
};
