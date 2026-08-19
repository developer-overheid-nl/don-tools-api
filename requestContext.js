const { AsyncLocalStorage } = require("node:async_hooks");

const requestContext = new AsyncLocalStorage();

const getRequestContext = () => requestContext.getStore() || {};

const runWithRequestContext = (context, callback) => requestContext.run(context, callback);

module.exports = {
  getRequestContext,
  runWithRequestContext,
};
