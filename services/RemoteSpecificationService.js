const { fetch } = require("@stoplight/spectral-runtime");
const Service = require("./Service");
const logger = require("../logger");

const DEFAULT_ERROR_MESSAGE = "Het ophalen van de specificatie is mislukt.";
const DEFAULT_TIMEOUT_MS = 45000;

const resolveTimeoutMs = () => {
  const envValue = Number(process.env.OAS_FETCH_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }
  return DEFAULT_TIMEOUT_MS;
};

const buildFetchOptions = (url) => {
  const controller = new AbortController();
  const timeout = resolveTimeoutMs();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const options = {
    signal: controller.signal,
  };
  return { options, cleanup: () => clearTimeout(timeoutId), timeout };
};

const normalizeErrorDetail = (error) => {
  const parts = [];
  if (error?.message) {
    parts.push(error.message);
  }
  if (error?.code) {
    parts.push(`code=${error.code}`);
  }
  if (error?.type) {
    parts.push(`type=${error.type}`);
  }
  return parts.join(" ").trim() || "Onbekende netwerkfout";
};

const fetchSpecification = async (url, { errorMessage = DEFAULT_ERROR_MESSAGE } = {}) => {
  const { options, cleanup, timeout } = buildFetchOptions(url);
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Server gaf status ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    const detail = normalizeErrorDetail(error);
    logger.error(
      `[RemoteSpecificationService] fetch failed for ${url}: ${detail}${error?.stack ? ` stack=${error.stack}` : ""}`,
    );
    throw Service.rejectResponse(
      {
        message: errorMessage,
        detail,
        timeout,
      },
      400,
    );
  } finally {
    cleanup();
  }
};

module.exports = {
  fetchSpecification,
};
