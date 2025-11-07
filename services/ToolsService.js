/* eslint-disable no-unused-vars */
const Service = require("./Service");
const OasConversionService = require("./OasConversionService");
const OasDereferenceService = require("./OasDereferenceService");
const OasValidatorService = require("./OasValidatorService");
const PostmanConversionService = require("./PostmanConversionService");
const BrunoConversionService = require("./BrunoConversionService");
const ArazzoVisualizationService = require("./ArazzoVisualizationService");
const { KeycloakService, parseUntrustClientInput, translateKeycloakError } = require("./KeycloakService");
const logger = require("../logger");

const keycloakService = KeycloakService.fromEnv();

const logServiceError = (operation, error) => {
  const detail = error?.detail || error?.message || "unknown error";
  const stack = error?.stack ? ` stack=${error.stack}` : "";
  logger.error(`[ToolsService] ${operation} failed: ${detail}${stack}`);
};

/**
 * Visualiseer Arazzo (POST)
 * Converteert een OpenAPI Arazzo specificatie naar Markdown en Mermaid. Body: { arazzoUrl|arazzoBody }
 *
 * arazzoInput ArazzoInput  (optional)
 * returns ModelsArazzoVisualization
 */
// const arazzo = async ({ arazzoInput }) => {
const arazzo = async (params) => {
  try {
    const mockResult = await Service.applyMock("ToolsService", "arazzo", params);
    if (mockResult !== undefined) {
      if (mockResult.action === "reject") {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    const requestPayload = Service.extractRequestBody(params);
    const visualization = await ArazzoVisualizationService.visualize(requestPayload);
    return Service.successResponse(visualization);
  } catch (e) {
    logServiceError("arazzo", e);
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
 * Converteer OpenAPI 3.0/3.1
 * Zet OpenAPI 3.0 om naar 3.1 of andersom. Body: { oasUrl } of { oasBody } (stringified JSON of YAML).
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
 * Maak Bruno-collectie (POST)
 * Converteert OpenAPI naar Bruno ZIP. Body: { oasUrl } of { oasBody } (stringified JSON of YAML).
 *
 * oASInput OASInput  (optional)
 * no response value expected for this operation
 */
// const createBrunoCollection = async ({ oASInput }) => {
const createBrunoCollection = async (params) => {
  try {
    const mockResult = await Service.applyMock("ToolsService", "createBrunoCollection", params);
    if (mockResult !== undefined) {
      if (mockResult.action === "reject") {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    const requestPayload = Service.extractRequestBody(params);
    const result = await BrunoConversionService.convert(requestPayload);
    return {
      code: 200,
      headers: result.headers,
      payload: result.rawBody,
    };
  } catch (e) {
    logServiceError("createBrunoCollection", e);
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
 * Dereference OpenAPI
 * Haalt externe $ref verwijzingen op en levert één compleet OpenAPI document terug. Body: { oasUrl } of { oasBody }.
 *
 * oASInput OASInput  (optional)
 * no response value expected for this operation
 */
// const dereferenceOAS = async ({ oASInput }) => {
const dereferenceOAS = async (params) => {
  try {
    const mockResult = await Service.applyMock("ToolsService", "dereferenceOAS", params);
    if (mockResult !== undefined) {
      if (mockResult.action === "reject") {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    const requestPayload = Service.extractRequestBody(params);
    const result = await OasDereferenceService.dereference(requestPayload);
    return {
      code: 200,
      headers: result.headers,
      payload: result.rawBody,
    };
  } catch (e) {
    logServiceError("dereferenceOAS", e);
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
 * Zet OpenAPI 3.0 om naar 3.1 of andersom. Body: { oasUrl } of { oasBody } (stringified JSON of YAML).
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
    return Service.successResponse(params);
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
  arazzo,
  convertOAS,
  createBrunoCollection,
  createPostmanCollection,
  dereferenceOAS,
  generateOAS,
  untrustClient,
  validatorOpenAPIPost,
};
