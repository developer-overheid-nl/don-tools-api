/* eslint-disable no-unused-vars */
const Service = require('./Service');

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
    const mockResult = await Service.applyMock('ToolsService', 'arazzo', params);
    if (mockResult !== undefined) {
      if (mockResult.action === 'reject') {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    return Service.successResponse(params);
  } catch (e) {
    throw Service.rejectResponse(
      e.message || 'Invalid input',
      e.status || 405,
    );
  }
};

/**
 * Converteer OpenAPI 3.0/3.1
 * Zet OpenAPI 3.0 om naar 3.1 of andersom. Body: { oasUrl } of { oasBody } (stringified JSON of YAML).
 *
 * convertOASInput ConvertOASInput  (optional)
 * no response value expected for this operation
 */
// const convertOAS = async ({ convertOASInput }) => {
const convertOAS = async (params) => {
  try {
    const mockResult = await Service.applyMock('ToolsService', 'convertOAS', params);
    if (mockResult !== undefined) {
      if (mockResult.action === 'reject') {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    return Service.successResponse(params);
  } catch (e) {
    throw Service.rejectResponse(
      e.message || 'Invalid input',
      e.status || 405,
    );
  }
};

/**
 * Maak Bruno-collectie (POST)
 * Converteert OpenAPI naar Bruno ZIP. Body: { oasUrl } of { oasBody } (stringified JSON of YAML).
 *
 * createBrunoCollectionInput CreateBrunoCollectionInput  (optional)
 * no response value expected for this operation
 */
// const createBrunoCollection = async ({ createBrunoCollectionInput }) => {
const createBrunoCollection = async (params) => {
  try {
    const mockResult = await Service.applyMock('ToolsService', 'createBrunoCollection', params);
    if (mockResult !== undefined) {
      if (mockResult.action === 'reject') {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    return Service.successResponse(params);
  } catch (e) {
    throw Service.rejectResponse(
      e.message || 'Invalid input',
      e.status || 405,
    );
  }
};

/**
 * Maak Postman-collectie (POST)
 * Converteert OpenAPI naar Postman Collection JSON. Body: { oasUrl } of { oasBody } (stringified JSON of YAML).
 *
 * createPostmanCollectionInput CreatePostmanCollectionInput  (optional)
 * no response value expected for this operation
 */
// const createPostmanCollection = async ({ createPostmanCollectionInput }) => {
const createPostmanCollection = async (params) => {
  try {
    const mockResult = await Service.applyMock('ToolsService', 'createPostmanCollection', params);
    if (mockResult !== undefined) {
      if (mockResult.action === 'reject') {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    return Service.successResponse(params);
  } catch (e) {
    throw Service.rejectResponse(
      e.message || 'Invalid input',
      e.status || 405,
    );
  }
};

/**
 * Dereference OpenAPI
 * Haalt externe $ref verwijzingen op en levert één compleet OpenAPI document terug. Body: { oasUrl } of { oasBody }.
 *
 * dereferenceOASInput DereferenceOASInput  (optional)
 * no response value expected for this operation
 */
// const dereferenceOAS = async ({ dereferenceOASInput }) => {
const dereferenceOAS = async (params) => {
  try {
    const mockResult = await Service.applyMock('ToolsService', 'dereferenceOAS', params);
    if (mockResult !== undefined) {
      if (mockResult.action === 'reject') {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    return Service.successResponse(params);
  } catch (e) {
    throw Service.rejectResponse(
      e.message || 'Invalid input',
      e.status || 405,
    );
  }
};

/**
 * Generate OpenAPI
 * Zet OpenAPI 3.0 om naar 3.1 of andersom. Body: { oasUrl } of { oasBody } (stringified JSON of YAML).
 *
 * generateOASInput GenerateOASInput  (optional)
 * no response value expected for this operation
 */
// const generateOAS = async ({ generateOASInput }) => {
const generateOAS = async (params) => {
  try {
    const mockResult = await Service.applyMock('ToolsService', 'generateOAS', params);
    if (mockResult !== undefined) {
      if (mockResult.action === 'reject') {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    return Service.successResponse(params);
  } catch (e) {
    throw Service.rejectResponse(
      e.message || 'Invalid input',
      e.status || 405,
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
    const mockResult = await Service.applyMock('ToolsService', 'untrustClient', params);
    if (mockResult !== undefined) {
      if (mockResult.action === 'reject') {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    return Service.successResponse(params);
  } catch (e) {
    throw Service.rejectResponse(
      e.message || 'Invalid input',
      e.status || 405,
    );
  }
};

/**
 * Validate OpenAPI (POST)
 * Valideert een OpenAPI specificatie met de DON ADR ruleset. Body: { oasUrl } of { oasBody } (stringified JSON of YAML).
 *
 * validatorOpenAPIPostInput ValidatorOpenAPIPostInput  (optional)
 * returns ModelsLintResult
 */
// const validatorOpenAPIPost = async ({ validatorOpenAPIPostInput }) => {
const validatorOpenAPIPost = async (params) => {
  try {
    const mockResult = await Service.applyMock('ToolsService', 'validatorOpenAPIPost', params);
    if (mockResult !== undefined) {
      if (mockResult.action === 'reject') {
        throw mockResult.value;
      }
      return mockResult.value;
    }
    return Service.successResponse(params);
  } catch (e) {
    throw Service.rejectResponse(
      e.message || 'Invalid input',
      e.status || 405,
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
