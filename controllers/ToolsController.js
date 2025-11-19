/**
 * The ToolsController file is a very simple one, which does not need to be changed manually,
 * unless there's a case where business logic routes the request to an entity which is not
 * the service.
 * The heavy lifting of the Controller item is done in Request.js - that is where request
 * parameters are extracted and sent to the service, and where response is handled.
 */

const Controller = require("./Controller");
const service = require("../services/ToolsService");

const arazzoMarkdown = async (request, response) => {
  await Controller.handleRequest(request, response, service.arazzoMarkdown);
};

const arazzoMermaid = async (request, response) => {
  await Controller.handleRequest(request, response, service.arazzoMermaid);
};

const convertOAS = async (request, response) => {
  await Controller.handleRequest(request, response, service.convertOAS);
};

const createPostmanCollection = async (request, response) => {
  await Controller.handleRequest(request, response, service.createPostmanCollection);
};

const bundleOAS = async (request, response) => {
  await Controller.handleRequest(request, response, service.bundleOAS);
};

const generateOAS = async (request, response) => {
  await Controller.handleRequest(request, response, service.generateOAS);
};

const untrustClient = async (request, response) => {
  await Controller.handleRequest(request, response, service.untrustClient);
};

const validatorOpenAPIPost = async (request, response) => {
  await Controller.handleRequest(request, response, service.validatorOpenAPIPost);
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
