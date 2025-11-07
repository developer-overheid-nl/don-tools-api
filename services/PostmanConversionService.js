const Service = require("./Service");
const { resolveOasInput } = require("./OasInputService");
const openapiToPostman = require("openapi-to-postmanv2");
const { sanitizeFileName } = require("../utils/fileName");

const EMPTY_BODY_ERROR = "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody";
const DEFAULT_COLLECTION_NAME = "postman-collection";

const convertToPostman = (data) =>
  new Promise((resolve, reject) => {
    openapiToPostman.convert({ type: "string", data }, {}, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      if (!result || result.result !== true) {
        const reason =
          result && typeof result.reason === "string" ? result.reason : "Conversie naar Postman is mislukt.";
        reject(new Error(reason));
        return;
      }
      resolve(result);
    });
  });

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

  const trimmed = typeof resolved.contents === "string" ? resolved.contents.trim() : "";
  if (!trimmed) {
    throw Service.rejectResponse({ message: EMPTY_BODY_ERROR }, 400);
  }

  let conversionResult;
  try {
    conversionResult = await convertToPostman(trimmed);
  } catch (error) {
    throw Service.rejectResponse(
      {
        message: error.message || "Conversie naar Postman is mislukt.",
      },
      500,
    );
  }

  const collectionOutput = Array.isArray(conversionResult.output)
    ? conversionResult.output.find((item) => item.type === "collection")
    : null;
  if (!collectionOutput || !collectionOutput.data) {
    throw Service.rejectResponse(
      {
        message: "Conversie naar Postman heeft geen collectie opgeleverd.",
      },
      500,
    );
  }

  const collection = collectionOutput.data;
  const collectionName = collection?.info?.name || DEFAULT_COLLECTION_NAME;
  const filenameBase = sanitizeFileName(collectionName, {
    fallback: DEFAULT_COLLECTION_NAME,
    lowercase: true,
  });
  const json = JSON.stringify(collection, null, 2);

  return {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filenameBase}.json"`,
    },
    rawBody: Buffer.from(json, "utf8"),
  };
};

module.exports = {
  convert,
};
