const Service = require("./Service");
const { fetchSpecification } = require("./RemoteSpecificationService");

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
    const contents = await fetchSpecification(parsedUrl.toString(), {
      errorMessage: "Het ophalen van de OpenAPI specificatie is mislukt.",
    });
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
