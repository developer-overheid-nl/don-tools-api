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

const doFetch = async (url, { origin }) => {
  const { options, cleanup, timeout } = buildFetchOptions(url);
  try {
    const headers = {};
    if (origin) {
      headers.Origin = origin;
    }
    options.headers = headers;
    const response = await fetch(url, options);
    if (!response.ok) {
      const preview = await response.text().catch(() => "");
      const trimmed = preview ? preview.slice(0, 200) : "";
      throw new Error(`Server gaf status ${response.status}${trimmed ? `: ${trimmed}` : ""}`);
    }
    return await response.text();
  } catch (error) {
    error.timeout = timeout;
    throw error;
  } finally {
    cleanup();
  }
};

const fetchSpecification = async (url, { errorMessage = DEFAULT_ERROR_MESSAGE } = {}) => {
  const origin = "https://developer.overheid.nl";
  const attempts = origin ? [{ origin }, { origin: undefined }] : [{ origin: undefined }];
  let lastError;
  for (const attempt of attempts) {
    try {
      return await doFetch(url, attempt);
    } catch (error) {
      lastError = error;
      const detail = normalizeErrorDetail(error);
      logger.error(
        `[RemoteSpecificationService] fetch failed for ${url} (${attempt.origin ? "with" : "without"} Origin): ${detail}${
          error?.stack ? ` stack=${error.stack}` : ""
        }`,
      );
      // continue to next attempt
    }
  }

  const detail = normalizeErrorDetail(lastError);
  throw Service.rejectResponse(
    {
      message: errorMessage,
      detail,
      timeout: lastError?.timeout,
    },
    400,
  );
};

module.exports = {
  fetchSpecification,
};
