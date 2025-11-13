/* eslint-disable no-unused-vars */
const Service = require("./Service");
const OasConversionService = require("./OasConversionService");
const OasBundleService = require("./OasBundleService");
const OasValidatorService = require("./OasValidatorService");
const OasGeneratorService = require("./OasGeneratorService");
const PostmanConversionService = require("./PostmanConversionService");
const ArazzoVisualizationService = require("./ArazzoVisualizationService");
const { KeycloakService, parseUntrustClientInput, translateKeycloakError } = require("./KeycloakService");
const logger = require("../logger");

const keycloakService = KeycloakService.fromEnv();

const logServiceError = (operation, error) => {
  const detail = error?.detail || error?.message || "unknown error";
  const stack = error?.stack ? ` stack=${error.stack}` : "";
  logger.error(`[ToolsService] ${operation} failed: ${detail}${stack}`);
};

const CONTENT_TYPE_MARKDOWN = "text/markdown; charset=utf-8";
const CONTENT_TYPE_TEXT = "text/plain; charset=utf-8";

const handleArazzoVisualization = async ({ operationId, params, pick, contentType }) => {
  try {
    const mockResult = await Service.applyMock("ToolsService", operationId, params);
    if (mockResult !== undefined) {
      if (mockResult.action === "reject") {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    const requestPayload = Service.extractRequestBody(params);
    const visualization = await ArazzoVisualizationService.visualize(requestPayload);
    const body = pick(visualization) || "";
    return {
      code: 200,
      headers: {
        "Content-Type": contentType,
      },
      payload: body,
    };
  } catch (e) {
    logServiceError(operationId, e);
    const status = typeof e.status === "number" && e.status > 0 ? e.status : 400;
    const message = e?.message ? e.message : "Er is een fout opgetreden.";
    throw Service.rejectResponse(
      {
        message,
        detail: e.detail || message,
      },
      status,
    );
  }
};

/**
 * Arazzo Markdown (POST)
 * Genereert alleen de Markdown-uitvoer van een Arazzo specificatie.
 *
 * arazzoInput ArazzoInput  (optional)
 * no response value expected for this operation
 */
const arazzoMarkdown = async (params) =>
  handleArazzoVisualization({
    operationId: "arazzoMarkdown",
    params,
    pick: (visualization) => visualization.markdown,
    contentType: CONTENT_TYPE_MARKDOWN,
  });

/**
 * Arazzo Mermaid (POST)
 * Genereert de Mermaid flowchart van een Arazzo specificatie.
 *
 * arazzoInput ArazzoInput  (optional)
 * no response value expected for this operation
 */
const arazzoMermaid = async (params) =>
  handleArazzoVisualization({
    operationId: "arazzoMermaid",
    params,
    pick: (visualization) => visualization.mermaid,
    contentType: CONTENT_TYPE_TEXT,
  });

/**
 * Converteer OpenAPI 3.0/3.1
 * Converteert standaard naar 3.1. Geef targetVersion (3.0 of 3.1) mee om een doelversie te forceren. Body: { oasUrl } of { oasBody } (stringified JSON of YAML).
 *
 * oASInput OASInput  (optional)
 * no response value expected for this operation
 */
// const convertOAS = async ({ oASInput }) => {
const convertOAS = async (params) => {
  try {
    const mockResult = await Service.applyMock("ToolsService", "convertOAS", params);
    if (mockResult !== undefined) {
      if (mockResult.action === "reject") {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    const requestPayload = Service.extractRequestBody(params);
    const result = await OasConversionService.convert(requestPayload);
    return {
      code: 200,
      headers: result.headers,
      payload: result.rawBody,
    };
  } catch (e) {
    logServiceError("convertOAS", e);
    const status = typeof e.status === "number" && e.status > 0 ? e.status : 400;
    const message = e?.message ? e.message : "Er is een fout opgetreden.";
    throw Service.rejectResponse(
      {
        message,
        detail: e.detail || message,
      },
      status,
    );
  }
};

/**
 * Maak Postman-collectie (POST)
 * Converteert OpenAPI naar Postman Collection JSON. Body: { oasUrl } of { oasBody } (stringified JSON of YAML).
 *
 * oASInput OASInput  (optional)
 * no response value expected for this operation
 */
// const createPostmanCollection = async ({ oASInput }) => {
const createPostmanCollection = async (params) => {
  try {
    const mockResult = await Service.applyMock("ToolsService", "createPostmanCollection", params);
    if (mockResult !== undefined) {
      if (mockResult.action === "reject") {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    const requestPayload = Service.extractRequestBody(params);
    const result = await PostmanConversionService.convert(requestPayload);
    return {
      code: 200,
      headers: result.headers,
      payload: result.rawBody,
    };
  } catch (e) {
    logServiceError("createPostmanCollection", e);
    const status = typeof e.status === "number" && e.status > 0 ? e.status : 400;
    const message = e?.message ? e.message : "Er is een fout opgetreden.";
    throw Service.rejectResponse(
      {
        message,
        detail: e.detail || message,
      },
      status,
    );
  }
};

/**
 * Bundle OpenAPI
 * Maakt één gebundeld OpenAPI document met opgeloste verwijzingen. Body: { oasUrl } of { oasBody }.
 *
 * oASInput OASInput  (optional)
 * no response value expected for this operation
 */
const bundleOAS = async (params) => {
  try {
    const mockResult = await Service.applyMock("ToolsService", "bundleOAS", params);
    if (mockResult !== undefined) {
      if (mockResult.action === "reject") {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    const requestPayload = Service.extractRequestBody(params);
    const result = await OasBundleService.bundle(requestPayload);
    return {
      code: 200,
      headers: result.headers,
      payload: result.rawBody,
    };
  } catch (e) {
    logServiceError("bundleOAS", e);
    const status = typeof e.status === "number" && e.status > 0 ? e.status : 400;
    const message = e?.message ? e.message : "Er is een fout opgetreden.";
    throw Service.rejectResponse(
      {
        message,
        detail: e.detail || message,
      },
      status,
    );
  }
};

/**
 * Generate OpenAPI
 * Genereert een boilerplate OpenAPI document op basis van JSON-input. Body: { oasUrl } of { oasBody } (stringified JSON).
 *
 * oASInput OASInput  (optional)
 * no response value expected for this operation
 */
// const generateOAS = async ({ oASInput }) => {
const generateOAS = async (params) => {
  try {
    const mockResult = await Service.applyMock("ToolsService", "generateOAS", params);
    if (mockResult !== undefined) {
      if (mockResult.action === "reject") {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    const requestPayload = Service.extractRequestBody(params);
    const result = await OasGeneratorService.generate(requestPayload);
    return {
      code: 200,
      headers: result.headers,
      payload: result.rawBody,
    };
  } catch (e) {
    logServiceError("generateOAS", e);
    const status = typeof e.status === "number" && e.status > 0 ? e.status : 400;
    const message = e?.message ? e.message : "Er is een fout opgetreden.";
    throw Service.rejectResponse(
      {
        message,
        detail: e.detail || message,
      },
      status,
    );
  }
};

/**
 * Maak client (POST)
 * Maak een client aan via de admin API. Body bevat Email.
 *
 * untrustClientInput UntrustClientInput  (optional)
 * returns ModelsKeycloakClientResult
 */
// const untrustClient = async ({ untrustClientInput }) => {
const untrustClient = async (params) => {
  try {
    const mockResult = await Service.applyMock("ToolsService", "untrustClient", params);
    if (mockResult !== undefined) {
      if (mockResult.action === "reject") {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    const { email } = parseUntrustClientInput(params);
    if (!keycloakService.isConfigured()) {
      Service.throwHttpError(500, "Keycloak service niet geconfigureerd");
    }
    const result = await keycloakService.createClient({ email });
    return Service.successResponse(result);
  } catch (e) {
    logServiceError("untrustClient", e);
    if (Service.isErrorResponse(e)) {
      throw e;
    }
    const mapped = translateKeycloakError(e);
    if (mapped) {
      Service.throwHttpError(mapped.status, mapped.message);
    }
    const status = typeof e.status === "number" && e.status > 0 ? e.status : 400;
    const message = e?.message ? e.message : "Er is een fout opgetreden.";
    throw Service.rejectResponse(
      {
        message,
        detail: e.detail || message,
      },
      status,
    );
  }
};

/**
 * Validate OpenAPI (POST)
 * Valideert een OpenAPI specificatie met de DON ADR ruleset. Body: { oasUrl } of { oasBody } (stringified JSON of YAML).
 *
 * oASInput OASInput  (optional)
 * returns ModelsLintResult
 */
// const validatorOpenAPIPost = async ({ oASInput }) => {
const validatorOpenAPIPost = async (params) => {
  try {
    const mockResult = await Service.applyMock("ToolsService", "validatorOpenAPIPost", params);
    if (mockResult !== undefined) {
      if (mockResult.action === "reject") {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    const requestPayload = Service.extractRequestBody(params);
    const result = await OasValidatorService.validate(requestPayload);
    return Service.successResponse(result);
  } catch (e) {
    logServiceError("validatorOpenAPIPost", e);
    const status = typeof e.status === "number" && e.status > 0 ? e.status : 400;
    const message = e?.message ? e.message : "Er is een fout opgetreden.";
    throw Service.rejectResponse(
      {
        message,
        detail: e.detail || message,
      },
      status,
    );
  }
};

module.exports = {
  arazzoMarkdown,
  arazzoMermaid,
  convertOAS,
  createPostmanCollection,
  bundleOAS,
  generateOAS,
  untrustClient,
  validatorOpenAPIPost,
};
