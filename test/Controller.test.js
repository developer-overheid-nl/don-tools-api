const assert = require("node:assert/strict");
const test = require("node:test");
const Controller = require("../controllers/Controller");
const Service = require("../services/Service");

test("sendError includes nested service error detail in problem response", () => {
  let statusCode;
  let responseBody;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  Controller.sendError(
    response,
    Service.rejectResponse(
      {
        message: "Publieke foutmelding",
        detail: "Technische foutdetails uit onderliggende tooling",
      },
      422,
    ),
  );

  assert.equal(statusCode, 422);
  assert.equal(responseBody.title, "Unprocessable Entity");
  assert.equal(responseBody.detail, "Technische foutdetails uit onderliggende tooling");
});
