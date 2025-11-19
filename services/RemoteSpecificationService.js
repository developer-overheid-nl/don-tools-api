const { fetch } = require("@stoplight/spectral-runtime");
const Service = require("./Service");
const logger = require("../logger");

const DEFAULT_ERROR_MESSAGE = "Het ophalen van de specificatie is mislukt.";

const fetchSpecification = async (url, { errorMessage = DEFAULT_ERROR_MESSAGE } = {}) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Server gaf status ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    logger.error(
      `[RemoteSpecificationService] fetch failed for ${url}: ${error?.message || "unknown"}${
        error?.stack ? ` stack=${error.stack}` : ""
      }`,
    );
    throw Service.rejectResponse(
      {
        message: errorMessage,
        detail: error.message,
      },
      400,
    );
  }
};

module.exports = {
  fetchSpecification,
};
