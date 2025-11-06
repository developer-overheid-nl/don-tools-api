const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const spectralFunctions = require("@stoplight/spectral-functions");
const jsYaml = require("js-yaml");
const { Spectral, Document, Ruleset } = require("@stoplight/spectral-core");
const Parsers = require("@stoplight/spectral-parsers");
const { fetch } = require("@stoplight/spectral-runtime");
const { oas: oasRuleset } = require("@stoplight/spectral-rulesets");
const Service = require("./Service");
const logger = require("../logger");

const RULESET_PATH = path.join(__dirname, "..", "rulesets", "adr-ruleset.yaml");

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

let spectralInstancePromise;

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

const loadRulesetDefinition = async () => {
  try {
    const contents = await fs.readFile(RULESET_PATH, "utf8");
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
    throw new Error(error.message || "Onbekende fout bij het laden van het ruleset-bestand.");
  }
};

const loadSpectral = async () => {
  if (!spectralInstancePromise) {
    spectralInstancePromise = (async () => {
      try {
        const spectral = new Spectral();
        const rulesetDefinition = await loadRulesetDefinition();
        const ruleset = new Ruleset(rulesetDefinition, {
          severity: "recommended",
          source: RULESET_PATH,
        });
        spectral.setRuleset(ruleset);
        return spectral;
      } catch (error) {
        logger.error(`Unable to load Spectral ruleset from ${RULESET_PATH}: ${error.message}`);
        spectralInstancePromise = undefined;
        throw Service.rejectResponse(
          {
            message: "Kan het regels-bestand niet laden voor validatie.",
            detail: error.message,
          },
          500,
        );
      }
    })();
  }
  return spectralInstancePromise;
};

const fetchRemoteSpecification = async (oasUrl) => {
  try {
    const response = await fetch(oasUrl);
    if (!response.ok) {
      throw new Error(`Server gaf status ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    throw Service.rejectResponse(
      {
        message: "Het ophalen van de OpenAPI specificatie is mislukt.",
        detail: error.message,
      },
      400,
    );
  }
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
      throw Service.rejectResponse(
        {
          message: "De waarde van oasUrl is geen geldige URL.",
        },
        400,
      );
    }
    const contents = await fetchRemoteSpecification(parsedUrl.toString());
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

const buildLintResult = (diagnostics) => {
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
  };
};

const validate = async (input) => {
  const { contents, source } = await resolveSpecificationInput(input);
  const spectral = await loadSpectral();
  const document = new Document(contents, Parsers.Yaml, source);
  const parseDiagnostics = Array.isArray(document.diagnostics) ? document.diagnostics : [];
  const lintDiagnostics = await spectral.run(document, { ignoreUnknownFormat: false });
  const diagnostics = [...parseDiagnostics, ...lintDiagnostics];
  return buildLintResult(diagnostics);
};

module.exports = {
  validate,
};
