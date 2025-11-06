const { fetch } = require("@stoplight/spectral-runtime");
const Service = require("./Service");

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

const resolveOasInput = async (input) => {
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
    } catch {
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

module.exports = {
  resolveOasInput,
};
